import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { DataTable, Pager, type Column } from '../components/DataTable';
import { PageTitle } from '../components/Layout';
import { Alert, EmptyState, LoadingBlock, StatusBadge, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { STATUS_LABEL, formatDateTime, formatDzd } from '../lib/format';
import type { AdminOrder, AdminOrderDetail, OrderStatus } from '../lib/types';

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
          <p>منتجات {formatDzd(o.subtotal)} + توصيل {formatDzd(o.deliveryFee)}</p>
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

            <OrderDetailBody order={selected} />

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

const Row = ({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) => (
  <div className="flex justify-between gap-3">
    <dt className="text-slate-500">{label}</dt>
    <dd className={strong ? 'font-bold text-slate-900' : ''}>{children}</dd>
  </div>
);

const when = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : '—');

function QrImage({ payload, label }: { payload: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(payload, { margin: 1, width: 240 })
      .then((u) => alive && setSrc(u))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [payload]);
  return (
    <figure className="text-center">
      {src ? <img src={src} alt={label} className="mx-auto size-28" /> : <div className="mx-auto size-28 bg-slate-100" />}
      <figcaption className="text-xs text-slate-500">{label}</figcaption>
    </figure>
  );
}

/** كل تفاصيل الطلب للإدارة: الأطراف، المبالغ، التسوية النقدية، الأوقات، الرموز، وسجل المسح */
function OrderDetailBody({ order }: { order: AdminOrder }) {
  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .order(order.id)
      .then((r) => setDetail(r.order))
      .catch((e: ApiError) => setError(e.message));
  }, [order.id]);
  const s = order.settlement;
  const pickupScan = detail?.scans.find((x) => x.stage === 'PICKUP');
  const deliveryScan = detail?.scans.find((x) => x.stage === 'DELIVERY');

  return (
    <div className="space-y-4 text-sm">
      <dl className="space-y-2">
        <Row label="رقم الطلب"><span dir="ltr" className="font-mono">{order.code}</span></Row>
        <Row label="الزبون">{order.customer?.fullName ?? '—'}</Row>
        <Row label="هاتف الزبون"><span dir="ltr">{order.customer?.phone ?? '—'}</span></Row>
        <Row label="المحل">{order.shop?.name ?? '—'}</Row>
        <Row label="الموصّل">{order.driver?.user.fullName ?? '—'}</Row>
      </dl>

      <dl className="space-y-2 border-t border-slate-200 pt-3">
        <Row label="قيمة المنتجات">{formatDzd(s.productsAmount)}</Row>
        <Row label="رسوم التوصيل">{formatDzd(s.deliveryFee)}</Row>
        {s.discount > 0 && <Row label="الخصم">− {formatDzd(s.discount)}</Row>}
        <Row label="الإجمالي" strong>{formatDzd(s.total)}</Row>
      </dl>

      <dl className="space-y-2 rounded-xl bg-slate-50 p-3">
        <Row label="دفعه الموصّل للمحل">{pickupScan || order.pickedUpAt ? formatDzd(s.driverPaysShop) : `${formatDzd(s.driverPaysShop)} (عند الاستلام)`}</Row>
        <Row label="قبضه الموصّل من الزبون">{order.deliveredAt ? formatDzd(s.driverCollectsFromCustomer) : `${formatDzd(s.driverCollectsFromCustomer)} (عند التسليم)`}</Row>
        <Row label="أجرة التوصيل (نقدًا مع الموصّل)">{formatDzd(s.driverKeeps)}</Row>
        <Row label="عمولة المنصة">{formatDzd(order.commissionAmount)}</Row>
        <Row label="استحقاق الموصّل في المحفظة">{formatDzd(order.driverEarning)}</Row>
      </dl>

      <dl className="space-y-2 border-t border-slate-200 pt-3">
        <Row label="إنشاء الطلب">{when(order.createdAt)}</Row>
        <Row label="قبول المتجر">{when(order.acceptedAt)}</Row>
        <Row label="جاهزية الطلب">{when(order.readyAt)}</Row>
        <Row label="استلام الموصّل">{when(order.pickedUpAt)}</Row>
        <Row label="التسليم">{when(order.deliveredAt)}</Row>
      </dl>

      {error && <Alert>{error}</Alert>}
      {detail && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          <div className="grid grid-cols-2 gap-3">
            <QrImage payload={detail.pickupQr} label="QR الاستلام (المحل)" />
            <QrImage payload={detail.deliveryQr} label="QR التسليم (الزبون)" />
          </div>
          <dl className="space-y-2">
            <Row label="رمز التسليم PIN"><span dir="ltr" className="font-mono">{detail.deliveryPin}</span></Row>
            <Row label="مسح الاستلام">
              {pickupScan ? `${pickupScan.driver.user.fullName} · ${formatDateTime(pickupScan.createdAt)}` : '—'}
            </Row>
            <Row label="تأكيد التسليم">
              {deliveryScan
                ? `${deliveryScan.method === 'PIN' ? 'PIN' : 'QR'} · ${deliveryScan.driver.user.fullName} · ${formatDateTime(deliveryScan.createdAt)}`
                : '—'}
            </Row>
          </dl>
        </div>
      )}
    </div>
  );
}
