import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { EmptyState, ErrorState, SkeletonCard } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { timeAgo } from '../lib/format';
import type { Notification } from '../lib/types';

export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    api
      .notifications({ limit: 30 })
      .then((r) => setItems(r.items))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [reload]);

  async function markAll() {
    await api.markAllNotificationsRead().catch(() => undefined);
    setItems((current) => current.map((n) => ({ ...n, isRead: true })));
  }

  async function open(notification: Notification) {
    if (!notification.isRead) {
      api.markNotificationRead(notification.id).catch(() => undefined);
      setItems((current) =>
        current.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)),
      );
    }
  }

  const unread = items.filter((n) => !n.isRead).length;

  return (
    <div>
      <PageHeader
        title="الإشعارات"
        subtitle={unread > 0 ? `${unread} غير مقروء` : undefined}
        action={
          unread > 0 ? (
            <button type="button" onClick={markAll} className="text-sm text-brand-700">
              تعليم الكل كمقروء
            </button>
          ) : undefined
        }
      />

      <div className="space-y-2 px-4 py-3">
        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReload((k) => k + 1)} />
        ) : items.length === 0 ? (
          <EmptyState icon="🔔" title="لا توجد إشعارات" description="ستصلك هنا تحديثات طلباتك." />
        ) : (
          items.map((notification) => {
            const content = (
              <div
                className={`rounded-2xl border p-4 ${
                  notification.isRead ? 'border-slate-200 bg-white' : 'border-brand-200 bg-brand-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{notification.title}</h3>
                  {!notification.isRead && <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-600" />}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{notification.body}</p>
                <p className="mt-1.5 text-xs text-slate-400">{timeAgo(notification.createdAt)}</p>
              </div>
            );

            return notification.orderId ? (
              <Link
                key={notification.id}
                to={`/orders/${notification.orderId}`}
                onClick={() => open(notification)}
                className="block active:scale-[0.99]"
              >
                {content}
              </Link>
            ) : (
              <button
                key={notification.id}
                type="button"
                onClick={() => open(notification)}
                className="block w-full text-right"
              >
                {content}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
