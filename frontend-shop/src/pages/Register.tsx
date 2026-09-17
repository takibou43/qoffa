import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Field, inputClass } from '../components/ui';
import { ApiError, api, setToken } from '../lib/api';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    password: '',
    shopName: '',
    shopPhone: '',
    addressLine: '',
    city: '',
  });
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  function locate() {
    if (!('geolocation' in navigator)) {
      setError('المتصفح لا يدعم تحديد الموقع. أدخل الإحداثيات لاحقًا من إعدادات المحل.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords({ lat: p.coords.latitude, lon: p.coords.longitude });
        setLocating(false);
      },
      () => {
        setError('لم نتمكن من تحديد الموقع. اسمح بالوصول للموقع من المتصفح.');
        setLocating(false);
      },
      { timeout: 10_000 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (!coords) {
      setError('موقع المحل مطلوب حتى يجدك الزبائن والموصّلون. اضغط «تحديد موقع المحل».');
      return;
    }

    setLoading(true);
    try {
      const result = await api.registerShop({
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        password: form.password,
        shop: {
          name: form.shopName.trim(),
          phone: form.shopPhone.trim() || form.phone.trim(),
          addressLine: form.addressLine.trim(),
          city: form.city.trim(),
          latitude: coords.lat,
          longitude: coords.lon,
        },
      });
      setToken(result.token);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setFieldErrors(
          Object.fromEntries(err.details.map((d) => [d.field.replace('shop.', ''), d.message])),
        );
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'تعذّر إنشاء الحساب.');
      }
    } finally {
      setLoading(false);
    }
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: e.target.value });

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-6 text-center">
        <div className="text-5xl" aria-hidden>🏪</div>
        <h1 className="mt-2 text-xl font-bold text-brand-800">تسجيل محل جديد</h1>
        <p className="text-sm text-slate-500">يُراجع طلبك من إدارة المنصة قبل التفعيل</p>
      </div>

      <form onSubmit={submit} className="space-y-5">
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-900">بيانات صاحب المحل</h2>
          <Field label="الاسم الكامل" error={fieldErrors.fullName}>
            <input className={inputClass} value={form.fullName} onChange={set('fullName')} required />
          </Field>
          <Field label="رقم الهاتف" error={fieldErrors.phone} hint="سيُستعمل لتسجيل الدخول">
            <input className={inputClass} type="tel" inputMode="numeric" value={form.phone} onChange={set('phone')} required />
          </Field>
          <Field label="كلمة المرور" error={fieldErrors.password} hint="8 أحرف على الأقل">
            <input className={inputClass} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required />
          </Field>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-900">بيانات المحل</h2>
          <Field label="اسم المحل" error={fieldErrors.name}>
            <input className={inputClass} value={form.shopName} onChange={set('shopName')} required />
          </Field>
          <Field label="هاتف المحل" error={fieldErrors['shop.phone']} hint="اتركه فارغًا لاستعمال رقمك">
            <input className={inputClass} type="tel" inputMode="numeric" value={form.shopPhone} onChange={set('shopPhone')} />
          </Field>
          <Field label="العنوان" error={fieldErrors.addressLine}>
            <input className={inputClass} value={form.addressLine} onChange={set('addressLine')} required />
          </Field>
          <Field label="المدينة / البلدية" error={fieldErrors.city}>
            <input className={inputClass} value={form.city} onChange={set('city')} required />
          </Field>

          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            {coords ? (
              <p className="text-brand-700">
                ✓ تم تحديد موقع المحل ({coords.lat.toFixed(4)}, {coords.lon.toFixed(4)})
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-600">موقع المحل مطلوب</span>
                <Button variant="secondary" onClick={locate} loading={locating} type="button">
                  تحديد موقع المحل
                </Button>
              </div>
            )}
          </div>
        </section>

        {error && <Alert>{error}</Alert>}

        <Button type="submit" className="w-full" loading={loading}>
          إرسال طلب التسجيل
        </Button>
        <p className="text-center text-sm text-slate-600">
          لديك حساب؟{' '}
          <Link to="/login" className="font-semibold text-brand-700">
            تسجيل الدخول
          </Link>
        </p>
      </form>
    </div>
  );
}
