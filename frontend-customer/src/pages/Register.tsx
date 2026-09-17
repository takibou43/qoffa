import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Field, inputClass } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ fullName: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      await register({
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        password: form.password,
      });
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
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-6 text-center">
        <div className="text-5xl" aria-hidden>🧺</div>
        <h1 className="mt-2 text-2xl font-bold text-brand-800">قُفّة</h1>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">حساب جديد</h2>

        <Field label="الاسم الكامل" error={fieldErrors.fullName}>
          <input
            className={inputClass}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            autoComplete="name"
            required
          />
        </Field>

        <Field label="رقم الهاتف" error={fieldErrors.phone} hint="مثال: 0551234567">
          <input
            className={inputClass}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
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

        {error && <Alert>{error}</Alert>}

        <Button type="submit" className="w-full" loading={loading}>
          إنشاء الحساب
        </Button>

        <p className="text-center text-sm text-slate-600">
          لديك حساب؟{' '}
          <Link to="/login" className="font-semibold text-brand-700">
            سجّل الدخول
          </Link>
        </p>
      </form>
    </div>
  );
}
