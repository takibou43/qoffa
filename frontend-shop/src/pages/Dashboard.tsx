import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Alert, Button, ErrorState, LoadingBlock, StatusBadge } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDzd, timeAgo } from '../lib/format';
import type { Order, Shop, ShopStats } from '../lib/types';

const STATUS_HINT: Record<string, string> = {
  PENDING: 'محلك قيد المراجعة من إدارة المنصة. لا يمكنك استقبال طلبات حتى يُعتمد.',
  REJECTED: 'طلب تسجيل محلك مرفوض. تواصل مع إدارة المنصة.',
  SUSPENDED: 'محلك معلّق حاليًا. تواصل مع إدارة المنصة.',
};

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warn' }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [shop, setShop] = useState<Shop | null>(null);
  const [stats, setStats] = useState<ShopStats | null>(null);
  const [newOrders, setNewOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [s, st, orders] = await Promise.all([
        api.myShop(),
        api.stats().catch(() => ({ stats: null })),
        api.orders({ bucket: 'new', limit: 5 }).catch(() => ({ items: [] as Order[] })),
      ]);
      setShop(s.shop);
      setStats(st.stats as ShopStats | null);
      setNewOrders(orders.items);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // تحديث دوري خفيف لالتقاط الطلبات الجديدة
  useEffect(() => {
    const timer = setInterval(() => load(true), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  async function toggleOpen() {
    if (!shop) return;
    setToggling(true);
    try {
      const r = await api.setOpen(!shop.isOpen);
      setShop({ ...shop, isOpen: r.isOpen });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تغيير حالة المحل');
    } finally {
      setToggling(false);
    }
  }

  if (loading) return <LoadingBlock />;
  if (error && !shop) return <ErrorState message={error} onRetry={() => load()} />;
  if (!shop) return null;

  const approved = shop.status === 'APPROVED';

  return (
    <div>
      <PageHeader title={shop.name} subtitle={user?.fullName} />

      <div className="space-y-4 px-4 py-4">
        {!approved && <Alert kind="info">{STATUS_HINT[shop.status]}</Alert>}
        {error && <Alert>{error}</Alert>}

        {/* مفتاح فتح/غلق المحل */}
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <p className="text-sm font-bold text-slate-900">
              {shop.isOpen ? '🟢 المحل مفتوح' : '⚪ المحل مغلق'}
            </p>
            <p className="text-xs text-slate-500">
              ساعات العمل {shop.openingTime} — {shop.closingTime}
            </p>
          </div>
          <Button
            variant={shop.isOpen ? 'secondary' : 'primary'}
            onClick={toggleOpen}
            loading={toggling}
            disabled={!approved}
          >
            {shop.isOpen ? 'إغلاق المحل' : 'فتح المحل'}
          </Button>
        </div>

        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="طلبات اليوم" value={String(stats.todayOrders)} />
            <Stat label="مبيعات اليوم" value={formatDzd(stats.todaySales)} />
            <Stat
              label="طلبات جديدة"
              value={String(stats.pendingOrders)}
              tone={stats.pendingOrders > 0 ? 'warn' : 'default'}
            />
            <Stat label="قيد التحضير" value={String(stats.preparingOrders)} />
            <Stat label="جاهزة للاستلام" value={String(stats.readyOrders)} />
            <Stat label="عدد المنتجات" value={String(stats.totalProducts)} />
          </div>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">طلبات جديدة</h2>
            <Link to="/orders" className="text-sm text-brand-700">
              كل الطلبات
            </Link>
          </div>

          {newOrders.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
              لا توجد طلبات جديدة الآن.
            </p>
          ) : (
            <div className="space-y-2">
              {newOrders.map((order) => (
                <Link
                  key={order.id}
                  to={`/orders/${order.id}`}
                  className="block rounded-2xl border border-amber-200 bg-white p-4 active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900">{order.code}</h3>
                      <p className="text-xs text-slate-500">
                        {order.customer?.fullName} · {timeAgo(order.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-slate-500">{order.items.length} منتج</span>
                    <span className="font-bold">{formatDzd(order.productsAmount)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
