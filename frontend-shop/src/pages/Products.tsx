import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { CameraScanner, isCameraScanSupported } from '../components/CameraScanner';
import { ProductImage } from '../components/ProductImage';
import {
  Alert,
  Button,
  EmptyState,
  Field,
  SkeletonCard,
  inputClass,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDzd } from '../lib/format';
import { ACCEPT_ATTR, prepareImage } from '../lib/imageUpload';
import { lookupNotice } from '../lib/barcodeLookup';
import type { Category, Product } from '../lib/types';

type Filter = 'all' | 'available' | 'unavailable' | 'hidden';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'available', label: 'متوفر' },
  { key: 'unavailable', label: 'غير متوفر' },
  { key: 'hidden', label: 'مخفي' },
];

interface FormState {
  id?: string;
  name: string;
  price: string;
  unit: string;
  categoryId: string;
  /** صورة المنتج العالمي الحالية (للعرض فقط — لا يُكتب رابط صورة يدويًا) */
  imageUrl: string;
  /** صورة جديدة مختارة (مضغوطة) تُرفع بعد الحفظ */
  imageFile: Blob | null;
  imagePreview: string | null;
  description: string;
  isAvailable: boolean;
  isHidden: boolean;
  barcode: string;
  brand: string;
  stock: string;
  /** scan = إدخال الباركود أولًا، form = بيانات المنتج */
  step: 'scan' | 'form';
  /** بيانات المنتج العالمي للقراءة فقط (منتج موجود في المنصة) */
  locked: boolean;
  notice: string | null;
}

const EMPTY_FORM: FormState = {
  barcode: '',
  brand: '',
  stock: '',
  step: 'scan',
  locked: false,
  notice: null,
  name: '',
  price: '',
  unit: 'قطعة',
  categoryId: '',
  imageUrl: '',
  imageFile: null,
  imagePreview: null,
  description: '',
  isAvailable: true,
  isHidden: false,
};

/**
 * هل يستطيع المحل اختيار صورة لهذا المنتج؟ (الخادم يعيد التحقق دائمًا)
 *  - منتج جديد كليًا، أو منتج في المنصة بلا صورة بعد → نعم (أول صورة).
 *  - منتج خاص بمحلك (بلا باركود) → نعم، يمكنك استبدال صورته.
 *  - منتج مشترك له صورة → لا: تغييرها من صلاحية الإدارة.
 */
function imageEditable(form: FormState): boolean {
  if (!form.imageUrl) return true;
  return !form.locked && form.barcode === '';
}

export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  /** بحث واحد جارٍ فقط: الضغط المتكرر أو قراءات الكاميرا المتتالية لا تُرسل طلبات مكررة */
  const lookupInFlight = useRef<string | null>(null);
  const cameraSupported = isCameraScanSupported();

  useEffect(() => {
    api.categories('PRODUCT').then((r) => setCategories(r.items)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .products({ availability: filter, q: search || undefined, limit: 50 })
      .then((r) => {
        setProducts(r.items);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filter, search]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!form) return;
    setFormError(null);

    const price = Number(form.price);
    if (!Number.isInteger(price) || price < 1) {
      setFormError('السعر يجب أن يكون عددًا صحيحًا بالدينار (بدون فواصل).');
      return;
    }

    const stockText = form.stock.trim();
    const stock = stockText === '' ? null : Number(stockText);
    if (stock !== null && (!Number.isInteger(stock) || stock < 0)) {
      setFormError('الكمية يجب أن تكون عددًا صحيحًا (أو اتركها فارغة إن لم تتتبّع الكمية).');
      return;
    }

    // بيانات المحل فقط: السعر والكمية والتوفر — خاصة بمحلك ولا تمس المحلات الأخرى
    const shopFields: Record<string, unknown> = {
      price,
      stock,
      isAvailable: form.isAvailable,
      isHidden: form.isHidden,
    };
    // بيانات المنتج العالمي تُرسل فقط لمنتج جديد؛ المنتج الموجود في المنصة لا يغيّره المحل
    const payload: Record<string, unknown> = form.locked
      ? { ...shopFields, ...(form.barcode && !form.id ? { barcode: form.barcode } : {}) }
      : {
          ...shopFields,
          ...(form.barcode ? { barcode: form.barcode } : {}),
          name: form.name.trim(),
          brand: form.brand.trim() || null,
          unit: form.unit.trim() || 'قطعة',
          categoryId: form.categoryId || null,
          description: form.description.trim() || null,
        };

    setSaving(true);
    try {
      const saved = form.id
        ? await api.updateProduct(form.id, payload)
        : await api.createProduct(payload);
      // الصورة تُرفع بعد حفظ المنتج وتُربط بالمنتج العالمي (نفس الصورة لكل المحلات)
      let imageProblem: string | null = null;
      if (form.imageFile) {
        try {
          await api.uploadProductImage(saved.product.id, form.imageFile);
        } catch (e) {
          imageProblem = e instanceof ApiError ? e.message : 'تعذّر رفع الصورة.';
        }
      }
      closeForm();
      await load();
      if (imageProblem) setError(`تم حفظ المنتج، لكن لم تُرفع الصورة: ${imageProblem}`);
    } catch (e) {
      if (e instanceof ApiError && e.details?.length) {
        setFormError(e.details.map((d) => d.message).join(' · '));
      } else {
        setFormError(e instanceof ApiError ? e.message : 'تعذّر الحفظ.');
      }
    } finally {
      setSaving(false);
    }
  }

  function closeForm() {
    if (form?.imagePreview) URL.revokeObjectURL(form.imagePreview);
    setForm(null);
  }

  async function pickImage(file: File | undefined) {
    if (!form || !file) return;
    setFormError(null);
    setImageBusy(true);
    try {
      const blob = await prepareImage(file);
      if (form.imagePreview) URL.revokeObjectURL(form.imagePreview);
      setForm({ ...form, imageFile: blob, imagePreview: URL.createObjectURL(blob) });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'تعذّر تجهيز الصورة.');
    } finally {
      setImageBusy(false);
    }
  }

  function clearPickedImage() {
    if (!form) return;
    if (form.imagePreview) URL.revokeObjectURL(form.imagePreview);
    setForm({ ...form, imageFile: null, imagePreview: null });
  }

  /** حذف صورة منتج خاص بمحلك (الخادم يرفض لمنتج مشترك) */
  async function removeSavedImage() {
    if (!form?.id || !confirm('حذف صورة هذا المنتج؟')) return;
    setImageBusy(true);
    setFormError(null);
    try {
      await api.deleteProductImage(form.id);
      setForm({ ...form, imageUrl: '' });
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'تعذّر حذف الصورة.');
    } finally {
      setImageBusy(false);
    }
  }

  function editForm(product: Product): FormState {
    return {
      imageFile: null,
      imagePreview: null,
      id: product.id,
      barcode: product.barcode ?? '',
      brand: product.brand ?? '',
      stock: product.stock === null ? '' : String(product.stock),
      step: 'form',
      // منتج له باركود = منتج عالمي مشترك: بياناته العالمية للقراءة فقط
      locked: product.barcode !== null,
      notice:
        product.barcode !== null
          ? product.imageUrl
            ? 'بيانات المنتج (الاسم، الصورة…) مشتركة بين المحلات وتعدّلها الإدارة. يمكنك تعديل سعرك وكميتك وتوفرك.'
            : 'بيانات المنتج مشتركة بين المحلات. المنتج بلا صورة بعد — يمكنك إضافة صورته.'
          : null,
      name: product.name,
      price: String(product.price),
      unit: product.unit,
      categoryId: product.categoryId ?? '',
      imageUrl: product.imageUrl ?? '',
      description: product.description ?? '',
      isAvailable: product.isAvailable,
      isHidden: product.isHidden,
    };
  }

  /** البحث بالباركود ثم تحديد ما يلزم إدخاله — يُستعمل من زر «بحث» ومن نتيجة مسح الكاميرا */
  async function lookupCode(code: string) {
    setFormError(null);
    if (code === '') {
      setFormError('أدخل الباركود، أو اختر «بدون باركود».');
      return;
    }
    if (lookupInFlight.current !== null) return;
    lookupInFlight.current = code;
    setSearching(true);
    try {
      const r = await api.lookupBarcode(code);
      const notice = lookupNotice(r);
      setForm((prev) => {
        const base = prev ?? EMPTY_FORM;
        if (r.status === 'NEW') {
          return { ...base, barcode: r.barcode, step: 'form', locked: false, notice };
        }
        if (r.status === 'AVAILABLE_TO_ADD') {
          const p = r.product;
          return {
            ...base,
            barcode: p.barcode ?? code,
            step: 'form',
            locked: true,
            notice,
            name: p.name,
            brand: p.brand ?? '',
            unit: p.unit,
            categoryId: p.categoryId ?? '',
            imageUrl: p.imageUrl ?? '',
            description: p.description ?? '',
          };
        }
        return { ...editForm(r.listing), notice };
      });
    } catch (e) {
      setFormError(
        e instanceof ApiError && e.details?.length
          ? e.details.map((d) => d.message).join(' · ')
          : e instanceof ApiError
            ? e.message
            : 'تعذّر البحث بالباركود.',
      );
    } finally {
      lookupInFlight.current = null;
      setSearching(false);
    }
  }

  /** الخطوة الأولى: البحث بالباركود المُدخل يدويًا */
  async function lookup() {
    if (!form) return;
    await lookupCode(form.barcode.trim());
  }

  function onCameraDetected(code: string) {
    setScanning(false);
    void lookupCode(code.trim());
  }

  async function quickToggle(product: Product, key: 'isAvailable' | 'isHidden') {
    try {
      await api.updateProduct(product.id, { [key]: !product[key] });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر التحديث.');
    }
  }

  async function remove(product: Product) {
    if (!confirm(`حذف «${product.name}» نهائيًا؟`)) return;
    try {
      await api.deleteProduct(product.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر الحذف.');
    }
  }

  return (
    <div>
      <PageHeader
        title="المنتجات"
        action={
          <Button onClick={() => { setForm({ ...EMPTY_FORM }); setFormError(null); }}>
            + منتج
          </Button>
        }
      />

      <div className="px-4 py-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث في منتجاتك…"
          className={inputClass}
        />

        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${
                filter === f.key ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && <div className="mt-3"><Alert>{error}</Alert></div>}

        <div className="mt-3 space-y-2.5">
          {loading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : products.length === 0 ? (
            <EmptyState
              icon="📦"
              title="لا توجد منتجات"
              description="أضف أول منتج ليظهر للزبائن."
              action={<Button onClick={() => setForm({ ...EMPTY_FORM })}>إضافة منتج</Button>}
            />
          ) : (
            products.map((product) => (
              <div key={product.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex gap-3">
                  <ProductImage src={product.imageUrl} className="size-14" />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{product.name}</h3>
                    <p className="text-xs text-slate-500">
                      {formatDzd(product.price)} / {product.unit}
                      {product.stock !== null && <> · المخزون: {product.stock}</>}
                    </p>
                    {product.barcode && (
                      <p className="text-[11px] text-slate-400" dir="ltr">
                        {product.barcode}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {product.isHidden && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">مخفي</span>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          product.isAvailable ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {product.isAvailable ? 'متوفر' : 'غير متوفر'}
                      </span>
                      {product.category && (
                        <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">
                          {product.category.name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => quickToggle(product, 'isAvailable')}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700"
                  >
                    {product.isAvailable ? 'تعيين غير متوفر' : 'تعيين متوفر'}
                  </button>
                  <button
                    type="button"
                    onClick={() => quickToggle(product, 'isHidden')}
                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700"
                  >
                    {product.isHidden ? 'إظهار' : 'إخفاء'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormError(null);
                      setForm(editForm(product));
                    }}
                    className="rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700"
                  >
                    تعديل
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(product)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-600"
                  >
                    حذف
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* نموذج الإضافة/التعديل */}
      {form && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
            <h2 className="mb-4 text-lg font-bold text-slate-900">
              {form.id ? 'تعديل منتج' : form.locked ? 'إضافة منتج إلى محلك' : 'منتج جديد'}
            </h2>

            {form.step === 'scan' ? (
              <div className="space-y-3">
                <Field label="باركود المنتج" hint="امسحه بقارئ الباركود أو اكتبه — نتعرّف تلقائيًا إن كان المنتج موجودًا في المنصة">
                  <input
                    className={inputClass}
                    dir="ltr"
                    inputMode="numeric"
                    autoFocus
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void lookup();
                      }
                    }}
                    placeholder="6131234567890"
                  />
                </Field>
                {cameraSupported && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      setFormError(null);
                      setScanning(true);
                    }}
                  >
                    📷 مسح بالكاميرا
                  </Button>
                )}
                {formError && <Alert>{formError}</Alert>}
                <div className="flex gap-2 pt-1">
                  <Button className="flex-1" onClick={lookup} loading={searching}>
                    {searching ? 'جاري البحث عن المنتج…' : 'بحث'}
                  </Button>
                  <Button variant="secondary" className="flex-1" onClick={closeForm}>
                    إلغاء
                  </Button>
                </div>
                <button
                  type="button"
                  className="w-full text-center text-xs text-slate-500 underline"
                  onClick={() => setForm({ ...form, barcode: '', step: 'form', locked: false, notice: null })}
                >
                  منتج بدون باركود
                </button>
              </div>
            ) : (
            <div className="space-y-3">
              {form.notice && <Alert kind="info">{form.notice}</Alert>}

              {form.locked ? (
                /* منتج موجود في المنصة: نعرض بياناته العالمية وصورته للقراءة فقط */
                <div className="flex gap-3 rounded-2xl border border-brand-100 bg-brand-50/50 p-3">
                  <ProductImage src={form.imagePreview ?? form.imageUrl} className="size-20" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="text-[11px] font-medium text-brand-700">المنتج موجود بالفعل في قُفّة</p>
                    <p className="truncate font-semibold text-slate-900">{form.name}</p>
                    {form.brand && <p className="text-xs text-slate-600">العلامة: {form.brand}</p>}
                    <p className="text-xs text-slate-600">الحجم/الوحدة: {form.unit}</p>
                    {form.barcode && (
                      <p className="text-xs text-slate-500" dir="ltr">
                        Barcode: {form.barcode}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                form.barcode && (
                  <p className="text-xs text-slate-500" dir="ltr">
                    Barcode: {form.barcode}
                  </p>
                )
              )}

              {/* صورة المنتج العالمي */}
              {imageEditable(form) ? (
                <Field
                  label={form.imageUrl ? 'صورة المنتج' : form.locked ? 'إضافة صورة للمنتج (اختياري)' : 'صورة المنتج (اختياري)'}
                  hint="JPEG أو PNG أو WebP — تُضغط تلقائيًا، وتظهر لكل المحلات التي تبيع هذا المنتج"
                >
                  <div className="flex items-center gap-3">
                    {!form.locked && (
                      <ProductImage src={form.imagePreview ?? form.imageUrl} className="size-16" />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <label
                        className={`cursor-pointer rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 ${
                          imageBusy ? 'pointer-events-none opacity-60' : ''
                        }`}
                      >
                        {imageBusy ? 'جارٍ التجهيز…' : form.imageFile || form.imageUrl ? 'تغيير الصورة' : '📷 رفع صورة'}
                        <input
                          type="file"
                          accept={ACCEPT_ATTR}
                          className="sr-only"
                          onChange={(e) => {
                            void pickImage(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {form.imageFile && (
                        <button type="button" onClick={clearPickedImage} className="rounded-lg px-3 py-2 text-xs text-slate-500">
                          إلغاء الصورة المختارة
                        </button>
                      )}
                      {!form.imageFile && form.imageUrl && form.id && (
                        <button type="button" onClick={removeSavedImage} className="rounded-lg px-3 py-2 text-xs text-red-600">
                          حذف الصورة
                        </button>
                      )}
                    </div>
                  </div>
                </Field>
              ) : (
                <p className="text-xs text-slate-500">
                  صورة هذا المنتج مشتركة بين كل المحلات؛ تغييرها من صلاحية إدارة المنصة.
                </p>
              )}

              {!form.locked && (
              <>
              <Field label="اسم المنتج">
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>

              <Field label="العلامة التجارية (اختياري)">
                <input
                  className={inputClass}
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                />
              </Field>
              </>
              )}

              <div className={form.locked ? '' : 'grid grid-cols-2 gap-3'}>
                <Field label="السعر (دج)" hint="عدد صحيح">
                  <input
                    className={inputClass}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                  />
                </Field>
                {!form.locked && (
                  <Field label="الوحدة / الحجم">
                    <input
                      className={inputClass}
                      value={form.unit}
                      onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      placeholder="قطعة / كغ / 1L"
                    />
                  </Field>
                )}
              </div>

              <Field label="الكمية المتوفرة عندك (اختياري)" hint="اتركها فارغة إن لم تتتبّع الكمية">
                <input
                  className={inputClass}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </Field>

              {!form.locked && (
              <>
              <Field label="التصنيف">
                <select
                  className={inputClass}
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                >
                  <option value="">بدون تصنيف</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="وصف (اختياري)">
                <input
                  className={inputClass}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
              </>
              )}

              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-700"
                    checked={form.isAvailable}
                    onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })}
                  />
                  متوفر
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand-700"
                    checked={form.isHidden}
                    onChange={(e) => setForm({ ...form, isHidden: e.target.checked })}
                  />
                  مخفي عن الزبائن
                </label>
              </div>

              {formError && <Alert>{formError}</Alert>}

              <div className="flex gap-2 pt-1">
                <Button className="flex-1" onClick={save} loading={saving}>
                  حفظ
                </Button>
                <Button variant="secondary" className="flex-1" onClick={closeForm}>
                  إلغاء
                </Button>
              </div>
            </div>
            )}
          </div>
        </div>
      )}

      {scanning && (
        <CameraScanner onDetected={onCameraDetected} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}
