import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Alert, Button, ErrorState, Field, LoadingBlock, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Category, Shop } from '../lib/types';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'قيد المراجعة',
  APPROVED: 'معتمد',
  REJECTED: 'مرفوض',
  SUSPENDED: 'معلّق',
};

export default function Settings() {
  const { user, logout } = useAuth();
  const [shop, setShop] = useState<Shop | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);

  const [form, setForm] = useState({
    name: '',
    description: '',
    phone: '',
    addressLine: '',
    city: '',
    openingTime: '08:00',
    closingTime: '22:00',
    imageUrl: '',
    categoryId: '',
    latitude: 0,
    longitude: 0,
  });

  useEffect(() => {
    Promise.all([api.myShop(), api.categories('SHOP').catch(() => ({ items: [] }))])
      .then(([s, c]) => {
        setShop(s.shop);
        setCategories(c.items);
        setForm({
          name: s.shop.name,
          description: s.shop.description ?? '',
          phone: s.shop.phone,
          addressLine: s.shop.addressLine,
          city: s.shop.city,
          openingTime: s.shop.openingTime,
          closingTime: s.shop.closingTime,
          imageUrl: s.shop.imageUrl ?? '',
          categoryId: s.shop.categoryId ?? '',
          latitude: s.shop.latitude,
          longitude: s.shop.longitude,
        });
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function locate() {
    if (!('geolocation' in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({ ...f, latitude: p.coords.latitude, longitude: p.coords.longitude }));
        setLocating(false);
      },
      () => {
        setError('تعذّر تحديد الموقع. اسمح بالوصول للموقع من المتصفح.');
        setLocating(false);
      },
      { timeout: 10_000 },
    );
  }

  async function save() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const r = await api.updateShop({
        name: form.name.trim(),
        description: form.description.trim() || null,
        phone: form.phone.trim(),
        addressLine: form.addressLine.trim(),
        city: form.city.trim(),
        openingTime: form.openingTime,
        closingTime: form.closingTime,
        imageUrl: form.imageUrl.trim() || null,
        categoryId: form.categoryId || null,
        latitude: form.latitude,
        longitude: form.longitude,
      } as Partial<Shop>);
      setShop((s) => (s ? { ...s, ...r.shop } : s));
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.details?.length) {
        setError(e.details.map((d) => d.message).join(' · '));
      } else {
        setError(e instanceof ApiError ? e.message : 'تعذّر الحفظ.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingBlock />;
  if (!shop) return <ErrorState message={error ?? 'تعذّر تحميل بيانات المحل'} />;

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="pb-6">
      <PageHeader title="إعدادات المحل" subtitle={user?.fullName} />

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
          <span className="text-sm text-slate-600">حالة المحل لدى الإدارة</span>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              shop.status === 'APPROVED'
                ? 'bg-brand-50 text-brand-700'
                : shop.status === 'PENDING'
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-red-50 text-red-700'
            }`}
          >
            {STATUS_LABEL[shop.status]}
          </span>
        </div>

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900">بيانات المحل</h2>

          <Field label="اسم المحل">
            <input className={inputClass} value={form.name} onChange={set('name')} />
          </Field>
          <Field label="الوصف">
            <input className={inputClass} value={form.description} onChange={set('description')} />
          </Field>
          <Field label="هاتف المحل">
            <input className={inputClass} type="tel" inputMode="numeric" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="صورة المحل (رابط)" hint="رابط صورة على الإنترنت">
            <input className={inputClass} type="url" dir="ltr" value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://…" />
          </Field>
          <Field label="تصنيف المحل">
            <select className={inputClass} value={form.categoryId} onChange={set('categoryId')}>
              <option value="">بدون تصنيف</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </section>

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900">ساعات العمل والتوصيل</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الفتح">
              <input className={inputClass} type="time" dir="ltr" value={form.openingTime} onChange={set('openingTime')} />
            </Field>
            <Field label="الإغلاق">
              <input className={inputClass} type="time" dir="ltr" value={form.closingTime} onChange={set('closingTime')} />
            </Field>
          </div>
          <p className="text-xs text-slate-500">
            إن تساوى الوقتان يُعتبر المحل مفتوحًا 24 ساعة (مع مفتاح الفتح).
          </p>
          <p className="text-xs text-slate-500">
            رسوم التوصيل تحددها إدارة المنصة وتُحسب تلقائيًا حسب المسافة بين محلك والزبون.
          </p>
          <p className="text-xs text-slate-500">
            عمولة المنصة الحالية: {(shop.commissionBps / 100).toFixed(1)}% — تُحدَّد من إدارة المنصة.
          </p>
        </section>

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-bold text-slate-900">الموقع والعنوان</h2>
          <Field label="العنوان">
            <input className={inputClass} value={form.addressLine} onChange={set('addressLine')} />
          </Field>
          <Field label="المدينة / البلدية">
            <input className={inputClass} value={form.city} onChange={set('city')} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm">
            <span className="text-slate-600" dir="ltr">
              {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}
            </span>
            <Button variant="secondary" onClick={locate} loading={locating} type="button">
              تحديث الموقع
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <h2 className="mb-2 text-sm font-bold text-slate-900">التقييم</h2>
          ⭐ {shop.ratingAvg.toFixed(1)} من {shop.ratingCount} تقييم
        </section>

        {error && <Alert>{error}</Alert>}
        {saved && <Alert kind="success">تم حفظ التعديلات.</Alert>}

        <Button className="w-full" onClick={save} loading={saving}>
          حفظ التعديلات
        </Button>
        <Button variant="secondary" className="w-full" onClick={logout}>
          تسجيل الخروج
        </Button>
      </div>
    </div>
  );
}
