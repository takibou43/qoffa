import { useCallback, useEffect, useState } from 'react';
import { DataTable, Pager, type Column } from '../components/DataTable';
import { PageTitle } from '../components/Layout';
import { Alert, EmptyState, LoadingBlock, StatusBadge, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { STATUS_LABEL, formatDateTime, formatDzd } from '../lib/format';
import type { AdminOrder, OrderStatus } from '../lib/types';

const ALL_STATUSES: OrderStatus[] = [
  'PENDING', 'SHOP_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DRIVER_ASSIGNED',
  'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REJECTED', 'CANCELLED',
  'NO_DRIVER', 'FAILED_DELIVERY',
];

export default function Orders() {
  const [rows, setRows] = useState<AdminOrder[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminOrder | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .orders({ status: status || undefined, q: search || undefined, page, limit: 20 })
      .then((r) => {
        setRows(r.items);
        setMeta({ page: r.meta.page, totalPages: r.meta.totalPages, total: r.meta.total });
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<AdminOrder>[] = [
    {
      key: 'order',
      header: 'الطلب',
      render: (o) => (
        <button type="button" onClick={() => setSelected(o)} className="text-right">
          <p className="font-medium text-brand-700">{o.code}</p>
          <p className="text-xs text-slate-500">{formatDateTime(o.createdAt)}</p>
        </button>
      ),
    },
    { key: 'status', header: 'الحالة', render: (o) => <StatusBadge status={o.status} /> },
    {
      key: 'parties',
      header: 'الأطراف',
      hideOnMobile: true,
      render: (o) => (
        <div className="text-xs text-slate-600">
          <p>زبون: {o.customer?.fullName ?? '—'}</p>
          <p>محل: {o.shop?.name ?? '—'}</p>
          <p>موصّل: {o.driver?.user.fullName ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'money',
      header: 'المبالغ',
      render: (o) => (
        <div className="text-xs text-slate-600">
          <p className="font-bold text-slate-900">{formatDzd(o.total)}</p>
          <p>عمولة: {formatDzd(o.commissionAmount)}</p>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageTitle title="الطلبات" subtitle={`${meta.total} طلب`} />

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث برقم الطلب (QF-…)"
          className={`${inputClass} max-w-xs`}
          dir="ltr"
        />
        <select
          className={`${inputClass} max-w-56`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as OrderStatus | '');
            setPage(1);
          }}
        >
          <option value="">كل الحالات</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState icon="🧾" title="لا توجد طلبات" />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <Pager page={meta.page} totalPages={meta.totalPages} onChange={setPage} />
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{selected.code}</h3>
                <p className="text-xs text-slate-500">{formatDateTime(selected.createdAt)}</p>
              </div>
              <StatusBadge status={selected.status} />
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">الزبون</dt><dd>{selected.customer?.fullName ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">هاتف الزبون</dt><dd dir="ltr">{selected.customer?.phone ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">المحل</dt><dd>{selected.shop?.name ?? '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">الموصّل</dt><dd>{selected.driver?.user.fullName ?? '—'}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-2"><dt className="text-slate-500">المنتجات</dt><dd>{formatDzd(selected.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">التوصيل</dt><dd>{formatDzd(selected.deliveryFee)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">الإجمالي</dt><dd className="font-bold">{formatDzd(selected.total)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">عمولة المنصة</dt><dd>{formatDzd(selected.commissionAmount)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">أجرة الموصّل</dt><dd>{formatDzd(selected.driverEarning)}</dd></div>
              {selected.deliveredAt && (
                <div className="flex justify-between"><dt className="text-slate-500">وقت التسليم</dt><dd>{formatDateTime(selected.deliveredAt)}</dd></div>
              )}
            </dl>

            <button
              type="button"
              onClick={() => setSelected(null)}
              className="mt-5 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-medium text-slate-700"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
