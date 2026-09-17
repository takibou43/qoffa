import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageTitle } from '../components/Layout';
import { ErrorState, LoadingBlock } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDzd } from '../lib/format';
import type { Stats } from '../lib/types';

function Card({
  label,
  value,
  hint,
  tone = 'default',
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warn';
  to?: string;
}) {
  const inner = (
    <div
      className={`rounded-2xl border p-4 ${
        tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
  return to ? <Link to={to} className="block active:scale-[0.99]">{inner}</Link> : inner;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    api
      .stats()
      .then((r) => setStats(r.stats))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reload]);

  if (loading) return <LoadingBlock />;
  if (error || !stats) {
    return <ErrorState message={error ?? 'تعذّر التحميل'} onRetry={() => setReload((k) => k + 1)} />;
  }

  return (
    <div>
      <PageTitle
        title="لوحة المنصة"
        subtitle={user?.role === 'SUPER_ADMIN' ? 'صلاحيات مالك المنصة' : 'صلاحيات مدير'}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card label="الزبائن" value={String(stats.customers)} to="/users" />
        <Card label="المحلات المعتمدة" value={String(stats.shops)} to="/shops" />
        <Card label="الموصّلون المعتمدون" value={String(stats.drivers)} to="/drivers" />
        <Card label="طلبات اليوم" value={String(stats.todayOrders)} to="/orders" />

        <Card
          label="محلات قيد المراجعة"
          value={String(stats.pendingShops)}
          tone={stats.pendingShops > 0 ? 'warn' : 'default'}
          to="/shops"
        />
        <Card
          label="موصّلون قيد المراجعة"
          value={String(stats.pendingDrivers)}
          tone={stats.pendingDrivers > 0 ? 'warn' : 'default'}
          to="/drivers"
        />
        <Card label="طلبات مكتملة" value={String(stats.deliveredOrders)} />
        <Card label="طلبات ملغاة/مرفوضة" value={String(stats.cancelledOrders)} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card label="قيمة الطلبات المسلَّمة" value={formatDzd(stats.grossRevenue)} />
        <Card label="عمولة المنصة" value={formatDzd(stats.platformCommission)} />
        <Card label="مبيعات اليوم" value={formatDzd(stats.todayRevenue)} hint="الطلبات المسلَّمة اليوم" />
      </div>
    </div>
  );
}
