import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Field, inputClass } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

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
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر تسجيل الدخول.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="text-5xl" aria-hidden>🧺</div>
        <h1 className="mt-2 text-2xl font-bold text-brand-800">قُفّة</h1>
        <p className="text-sm text-slate-500">من حانوتك إلى بابك</p>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">تسجيل الدخول</h2>

        <Field label="رقم الهاتف">
          <input
            className={inputClass}
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0551234567"
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

        <p className="text-center text-sm text-slate-600">
          ليس لديك حساب؟{' '}
          <Link to="/register" className="font-semibold text-brand-700">
            أنشئ حسابًا
          </Link>
        </p>
        <p className="text-center">
          <Link to="/" className="text-xs text-slate-500">
            المتابعة كزائر
          </Link>
        </p>
      </form>
    </div>
  );
}
