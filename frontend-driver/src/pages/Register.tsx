import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Field, inputClass } from '../components/ui';
import { ApiError, api, setToken } from '../lib/api';

const VEHICLES = ['دراجة نارية', 'سيارة', 'دراجة هوائية', 'راجل'];

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    password: '',
    vehicleType: VEHICLES[0]!,
    plateNumber: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      const result = await api.registerDriver({
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        password: form.password,
        driver: {
          vehicleType: form.vehicleType,
          plateNumber: form.plateNumber.trim() || undefined,
        },
      });
      setToken(result.token);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.field, d.message])));
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'تعذّر إنشاء الحساب.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 py-8">
      <div className="mb-6 text-center">
        <div className="text-5xl" aria-hidden>🛵</div>
        <h1 className="mt-2 text-xl font-bold text-brand-800">تسجيل موصّل جديد</h1>
        <p className="text-sm text-slate-500">يُراجع حسابك من إدارة المنصة قبل التفعيل</p>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <Field label="الاسم الكامل" error={fieldErrors.fullName}>
          <input
            className={inputClass}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            required
          />
        </Field>
        <Field label="رقم الهاتف" error={fieldErrors.phone} hint="سيُستعمل لتسجيل الدخول">
          <input
            className={inputClass}
            type="tel"
            inputMode="numeric"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
          />
        </Field>
        <Field label="كلمة المرور" error={fieldErrors.password} hint="8 أحرف على الأقل">
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </Field>
        <Field label="وسيلة التنقّل">
          <select
            className={inputClass}
            value={form.vehicleType}
            onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}
          >
            {VEHICLES.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="رقم اللوحة (اختياري)">
          <input
            className={inputClass}
            dir="ltr"
            value={form.plateNumber}
            onChange={(e) => setForm({ ...form, plateNumber: e.target.value })}
          />
        </Field>

        {error && <Alert>{error}</Alert>}

        <Button type="submit" className="w-full" loading={loading}>
          إرسال طلب التسجيل
        </Button>
        <p className="text-center text-sm text-slate-600">
          لديك حساب؟{' '}
          <Link to="/login" className="font-semibold text-brand-700">تسجيل الدخول</Link>
        </p>
      </form>
    </div>
  );
}
