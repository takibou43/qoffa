import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { EmptyState, ErrorState, SkeletonCard, StatusBadge } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDzd, timeAgo } from '../lib/format';
import type { Order } from '../lib/types';

const BUCKETS = [
  { key: 'new', label: 'جديدة' },
  { key: 'active', label: 'قيد التحضير' },
  { key: 'ready', label: 'جاهزة/قيد التوصيل' },
  { key: 'completed', label: 'مكتملة' },
  { key: 'cancelled', label: 'ملغاة' },
] as const;

export default function Orders() {
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]['key']>('new');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      return api
        .orders({ bucket, limit: 30 })
        .then((r) => {
          setOrders(r.items);
          setError(null);
        })
        .catch((e: ApiError) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [bucket],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => load(true), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div>
      <PageHeader title="الطلبات" />

      <div className="no-scrollbar sticky top-[57px] z-10 flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setBucket(b.key)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${
              bucket === b.key ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="space-y-2.5 px-4 py-3">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : error ? (
          <ErrorState message={error} onRetry={() => load()} />
        ) : orders.length === 0 ? (
          <EmptyState icon="🧾" title="لا توجد طلبات" description="ستظهر الطلبات هنا فور وصولها." />
        ) : (
          orders.map((order) => (
            <Link
              key={order.id}
              to={`/orders/${order.id}`}
              className="block rounded-2xl border border-slate-200 bg-white p-4 active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900">{order.code}</h3>
                  <p className="truncate text-xs text-slate-500">
                    {order.customer?.fullName ?? 'زبون'} · {timeAgo(order.createdAt)}
                  </p>
                </div>
                <StatusBadge status={order.status} />
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="text-slate-500">{order.items.length} منتج</span>
                <span className="font-bold">{formatDzd(order.total)}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
