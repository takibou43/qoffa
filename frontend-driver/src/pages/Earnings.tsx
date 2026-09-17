import { useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { ErrorState, LoadingBlock } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDzd } from '../lib/format';
import type { DriverStats } from '../lib/types';

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export default function Earnings() {
  const [stats, setStats] = useState<DriverStats | null>(null);
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
      <PageHeader title="أرباحي" />
      <div className="grid grid-cols-2 gap-3 px-4 py-4">
        <Card label="أرباح اليوم" value={formatDzd(stats.todayEarnings)} />
        <Card label="توصيلات اليوم" value={String(stats.todayDeliveries)} />
        <Card label="أرباح الأسبوع" value={formatDzd(stats.weekEarnings)} hint="آخر 7 أيام" />
        <Card label="توصيلات الأسبوع" value={String(stats.weekDeliveries)} />
      </div>
      <div className="px-4">
        <Card
          label="رصيد المحفظة"
          value={formatDzd(stats.walletBalance)}
          hint="مجموع مستحقاتك المسجّلة لدى المنصة"
        />
      </div>
    </div>
  );
}
