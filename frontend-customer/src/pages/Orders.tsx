import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Button, EmptyState, ErrorState, SkeletonCard, StatusBadge } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDzd, timeAgo } from '../lib/format';
import type { Order } from '../lib/types';

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    api
      .myOrders({ limit: 30 })
      .then((r) => setOrders(r.items))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reload]);

  return (
    <div>
      <PageHeader title="طلباتي" />

      <div className="space-y-3 px-4 py-3">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReload((k) => k + 1)} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon="📦"
            title="لا توجد طلبات بعد"
            description="عند إنشاء أول طلب ستجده هنا مع حالته لحظة بلحظة."
            action={
              <Link to="/">
                <Button>تصفّح المحلات</Button>
              </Link>
            }
          />
        ) : (
          orders.map((order) => (
            <Link
              key={order.id}
              to={`/orders/${order.id}`}
              className="block rounded-2xl border border-slate-200 bg-white p-4 active:scale-[0.99]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-slate-900">{order.shop.name}</h3>
                  <p className="text-xs text-slate-500">
                    {order.code} · {timeAgo(order.createdAt)}
                  </p>
                </div>
                <StatusBadge status={order.status} />
              </div>

              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-slate-500">
                  {order.items.length} منتج
                </span>
                <span className="font-bold text-slate-900">{formatDzd(order.total)}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
