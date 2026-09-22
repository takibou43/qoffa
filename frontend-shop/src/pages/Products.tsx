import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { CameraScanner, isCameraScanSupported } from '../components/CameraScanner';
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
  imageUrl: string;
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
  description: '',
  isAvailable: true,
  isHidden: false,
};

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
          imageUrl: form.imageUrl.trim() || null,
          description: form.description.trim() || null,
        };

    setSaving(true);
    try {
      if (form.id) await api.updateProduct(form.id, payload);
      else await api.createProduct(payload);
      setForm(null);
      await load();
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

  function editForm(product: Product): FormState {
    return {
      id: product.id,
      barcode: product.barcode ?? '',
      brand: product.brand ?? '',
      stock: product.stock === null ? '' : String(product.stock),
      step: 'form',
      // منتج له باركود = منتج عالمي مشترك: بياناته العالمية للقراءة فقط
      locked: product.barcode !== null,
      notice:
        product.barcode !== null
          ? 'بيانات المنتج (الاسم، الصورة…) مشتركة بين المحلات وتعدّلها الإدارة. يمكنك تعديل سعرك وكميتك وتوفرك.'
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
    setSaving(true);
    try {
      const r = await api.lookupBarcode(code);
      setForm((prev) => {
        const base = prev ?? EMPTY_FORM;
        if (r.status === 'NEW') {
          return { ...base, barcode: r.barcode, step: 'form', locked: false, notice: 'منتج جديد في المنصة: أدخل بياناته وسعرك.' };
        }
        if (r.status === 'AVAILABLE_TO_ADD') {
          const p = r.product;
          return {
            ...base,
            barcode: p.barcode ?? code,
            step: 'form',
            locked: true,
            notice: 'هذا المنتج موجود في المنصة — أدخل سعرك وكميتك فقط.',
            name: p.name,
            brand: p.brand ?? '',
            unit: p.unit,
            categoryId: p.categoryId ?? '',
            imageUrl: p.imageUrl ?? '',
            description: p.description ?? '',
          };
        }
        return { ...editForm(r.listing), notice: 'هذا المنتج موجود في محلك بالفعل — يمكنك تعديل سعره وكميته.' };
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
      setSaving(false);
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
                  <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="grid size-full place-items-center text-xl" aria-hidden>📦</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-slate-900">{product.name}</h3>
                    <p className="text-xs text-slate-500">
                      {formatDzd(product.price)} / {product.unit}
                    </p>
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
              {form.id ? 'تعديل منتج' : 'منتج جديد'}
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
                  <Button className="flex-1" onClick={lookup} loading={saving}>
                    بحث
                  </Button>
                  <Button variant="secondary" className="flex-1" onClick={() => setForm(null)}>
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

              {form.barcode && (
                <p className="text-xs text-slate-500" dir="ltr">
                  Barcode: {form.barcode}
                </p>
              )}

              <Field label="اسم المنتج">
                <input
                  className={inputClass}
                  value={form.name}
                  disabled={form.locked}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>

              <Field label="العلامة التجارية (اختياري)">
                <input
                  className={inputClass}
                  value={form.brand}
                  disabled={form.locked}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
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
                <Field label="الوحدة">
                  <input
                    className={inputClass}
                    value={form.unit}
                    disabled={form.locked}
                    onChange={(e) => setForm({ ...form, unit: e.target.value })}
                    placeholder="قطعة / كغ / لتر"
                  />
                </Field>
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

              <Field label="التصنيف">
                <select
                  className={inputClass}
                  value={form.categoryId}
                  disabled={form.locked}
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

              <Field label="رابط الصورة (اختياري)" hint="رابط صورة على الإنترنت">
                <input
                  className={inputClass}
                  type="url"
                  dir="ltr"
                  value={form.imageUrl}
                  disabled={form.locked}
                  onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                  placeholder="https://…"
                />
              </Field>

              <Field label="وصف (اختياري)">
                <input
                  className={inputClass}
                  value={form.description}
                  disabled={form.locked}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>

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
                <Button variant="secondary" className="flex-1" onClick={() => setForm(null)}>
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
