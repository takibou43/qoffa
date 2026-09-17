import type { ReactNode } from 'react';
import type { OrderStatus } from '../lib/types';
import { STATUS_LABEL, STATUS_TONE } from '../lib/format';

/* ── حالات التحميل ── */

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="جاري التحميل"
      className={`inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function LoadingBlock({ label = 'جاري التحميل…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Spinner className="text-brand-600" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex gap-3">
        <div className="size-16 shrink-0 rounded-xl bg-slate-200" />
        <div className="flex-1 space-y-2 py-1">
          <div className="h-4 w-2/3 rounded bg-slate-200" />
          <div className="h-3 w-1/3 rounded bg-slate-100" />
          <div className="h-3 w-1/2 rounded bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

/* ── الحالات الفارغة والأخطاء ── */

export function EmptyState({
  icon = '🧺',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="text-5xl">{icon}</div>
      <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      {description && <p className="max-w-xs text-sm leading-relaxed text-slate-500">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="text-4xl">⚠️</div>
      <p className="max-w-xs text-sm leading-relaxed text-slate-600">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white active:scale-[0.98]"
        >
          إعادة المحاولة
        </button>
      )}
    </div>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'success'; children: ReactNode }) {
  const styles = {
    error: 'bg-red-50 text-red-800 border-red-200',
    info: 'bg-blue-50 text-blue-800 border-blue-200',
    success: 'bg-brand-50 text-brand-800 border-brand-200',
  }[kind];
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles}`}>
      {children}
    </div>
  );
}

/* ── عناصر أساسية ── */

export function Button({
  children,
  variant = 'primary',
  loading = false,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
}) {
  const variants = {
    primary: 'bg-brand-700 text-white active:bg-brand-800 disabled:bg-brand-700/50',
    secondary: 'bg-white text-slate-800 border border-slate-300 active:bg-slate-50',
    ghost: 'text-brand-700 active:bg-brand-50',
    danger: 'bg-red-600 text-white active:bg-red-700 disabled:bg-red-400',
  }[variant];

  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 ${variants} ${className}`}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export const inputClass =
  'w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3.5 text-sm outline-none placeholder:text-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-100';

/* ── شارات ── */

export function StatusBadge({ status }: { status: OrderStatus }) {
  const tone = STATUS_TONE[status];
  const styles = {
    pending: 'bg-amber-50 text-amber-800 ring-amber-200',
    active: 'bg-blue-50 text-blue-800 ring-blue-200',
    done: 'bg-brand-50 text-brand-800 ring-brand-200',
    failed: 'bg-red-50 text-red-700 ring-red-200',
  }[tone];

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${styles}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function OpenBadge({ isOpenNow }: { isOpenNow: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        isOpenNow ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      <span className={`size-1.5 rounded-full ${isOpenNow ? 'bg-brand-600' : 'bg-slate-400'}`} />
      {isOpenNow ? 'مفتوح' : 'مغلق'}
    </span>
  );
}

export function Rating({ value, count }: { value: number; count: number }) {
  if (count === 0) return <span className="text-xs text-slate-400">جديد</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-600">
      <span aria-hidden>⭐</span>
      <span className="font-medium">{value.toFixed(1)}</span>
      <span className="text-slate-400">({count})</span>
    </span>
  );
}
