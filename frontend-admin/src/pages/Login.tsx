import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Field, inputClass } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(phone.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'تعذّر تسجيل الدخول.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="text-5xl" aria-hidden>🛡️</div>
        <h1 className="mt-2 text-2xl font-bold text-brand-800">قُفّة — إدارة المنصة</h1>
        <p className="text-sm text-slate-500">لوحة إدارة المنصة</p>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">تسجيل الدخول</h2>

        <Field label="البريد الإلكتروني أو رقم الهاتف">
          <input
            className={inputClass}
            type="text"
            inputMode="email"
            autoComplete="username"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="admin@example.com"
            required
          />
        </Field>

        <Field label="كلمة المرور">
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {error && <Alert>{error}</Alert>}

        <Button type="submit" className="w-full" loading={loading}>
          دخول
        </Button>

        <p className="text-center text-xs text-slate-500">
          حسابات الإدارة تُنشأ من مالك المنصة فقط. لا يوجد تسجيل عام.
        </p>
      </form>
    </div>
  );
}
