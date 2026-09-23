import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { OrderQr } from '../components/OrderQr';
import { Alert, Button, ErrorState, LoadingBlock, StatusBadge, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useOrderAlerts } from '../lib/orderAlertContext';
import { formatDateTime, formatDistance, formatDzd, mapsUrl, telUrl } from '../lib/format';
import type { Order } from '../lib/types';

export default function OrderDetail() {
  const { orderId = '' } = useParams();
  const alerts = useOrderAlerts();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      return api
        .order(orderId)
        .then((r) => setOrder(r.order))
        .catch((e: ApiError) => setError(e.message))
        .finally(() => setLoading(false));
    },
    [orderId],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function act(name: string, fn: () => Promise<unknown>) {
    setActionError(null);
    setBusy(name);
    try {
      await fn();
      // نجح الخادم فعلًا (لم يرمِ) → فقط الآن يُزال الطلب من قائمة الانتظار ويتوقف رنينه
      if (name === 'accept' || name === 'reject') alerts.handled(orderId);
      await load(true);
      setRejecting(false);
    } catch (e) {
      // فشل القبول/الرفض: الطلب ما زال PENDING في الخادم فيستمر الرنين. نعيد المزامنة للتأكد فقط.
      alerts.refresh();
      const failMsg =
        name === 'accept'
          ? 'تعذر قبول الطلب، حاول مرة أخرى.'
          : name === 'reject'
            ? 'تعذر رفض الطلب، حاول مرة أخرى.'
            : 'تعذّر تنفيذ العملية.';
      // 4xx (انتقال غير مسموح/صلاحية) رسالته من الخادم بالعربية؛ غير ذلك (شبكة/خادم/مهلة) رسالة ثابتة
      setActionError(e instanceof ApiError && e.status >= 400 && e.status < 500 ? e.message : failMsg);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <LoadingBlock />;
  if (error || !order) return <ErrorState message={error ?? 'الطلب غير موجود'} onRetry={() => load()} />;

  return (
    <div className="pb-6">
      <PageHeader
        title={`طلب ${order.code}`}
        subtitle={formatDateTime(order.createdAt)}
        action={
          <Link to="/orders" className="text-sm text-brand-700">
            الطلبات
          </Link>
        }
      />

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
          <span className="text-sm text-slate-600">حالة الطلب</span>
          <StatusBadge status={order.status} />
        </div>

        {order.status === 'NO_DRIVER' && (
          <Alert kind="info">
            لم يُعثر على موصّل متاح بعد. يمكنك إعادة المحاولة من الزر أسفل الصفحة — الطلب لم يُلغَ.
          </Alert>
        )}
        {order.status === 'READY_FOR_PICKUP' && (
          <Alert kind="info">الطلب جاهز — جارٍ البحث عن موصّل…</Alert>
        )}

        {order.pickupQr && order.status !== 'PENDING' && (
          <OrderQr
            payload={order.pickupQr}
            code={order.code}
            title="رمز استلام الطلبية"
            hint={`يمسحه الموصّل المعيَّن لاستلام الطلبية (مرة واحدة فقط). يدفع لك الموصّل ${formatDzd(order.amountFromDriver)}. اعرضه على الشاشة أو اطبعه على الكيس.`}
            verifiedAt={order.pickupVerifiedAt}
            verifiedLabel="استلم الموصّل الطلبية بمسح الرمز"
          />
        )}

        {/* الزبون */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-900">الزبون</h2>
          <p className="text-sm text-slate-700">{order.customer?.fullName}</p>
          <p className="text-sm text-slate-500">{order.customerPhone}</p>
          <p className="mt-2 text-sm text-slate-700">{order.deliveryAddressLine}</p>
          <p className="text-xs text-slate-500">{order.deliveryCity}</p>
          {order.distanceMeters !== null && (
            <p className="mt-1 text-xs text-slate-500">
              المسافة التقريبية: {formatDistance(order.distanceMeters)}
            </p>
          )}
          {order.customerNote && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              ملاحظة الزبون: {order.customerNote}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <a href={telUrl(order.customerPhone)} className="flex-1">
              <Button variant="secondary" className="w-full">📞 اتصال بالزبون</Button>
            </a>
            <a
              href={mapsUrl(order.deliveryLatitude, order.deliveryLongitude)}
              target="_blank"
              rel="noreferrer"
              className="flex-1"
            >
              <Button variant="secondary" className="w-full">🗺️ الموقع</Button>
            </a>
          </div>
        </section>

        {/* الموصّل */}
        {order.driver && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-bold text-slate-900">الموصّل</h2>
            <p className="text-sm text-slate-700">{order.driver.user.fullName}</p>
            <p className="text-xs text-slate-500">{order.driver.vehicleType}</p>
            <a href={telUrl(order.driver.user.phone)} className="mt-3 block">
              <Button variant="secondary" className="w-full">📞 اتصال بالموصّل</Button>
            </a>
          </section>
        )}

        {/* المنتجات */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-900">المنتجات المطلوبة</h2>
          <ul className="space-y-2 text-sm">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-slate-700">
                  <span className="font-bold text-brand-700">{item.quantity}×</span>{' '}
                  {item.nameSnapshot}
                  <span className="text-xs text-slate-400"> ({item.unitSnapshot})</span>
                </span>
                <span className="shrink-0 text-slate-600">{formatDzd(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
            <div className="flex justify-between text-base font-bold text-slate-900">
              <dt>قيمة المنتجات</dt>
              <dd>{formatDzd(order.productsAmount)}</dd>
            </div>
            <div className="flex justify-between rounded-lg bg-emerald-50 p-2 font-bold text-emerald-800">
              <dt>المبلغ الذي تستلمه من الموصّل</dt>
              <dd>{formatDzd(order.amountFromDriver)}</dd>
            </div>
          </dl>
        </section>

        {actionError && <Alert>{actionError}</Alert>}

        {/* أزرار الخطوات — الخادم هو من يسمح أو يرفض */}
        {order.status === 'PENDING' && !rejecting && (
          <div className="flex gap-2">
            <Button
              className="flex-1"
              loading={busy === 'accept'}
              onClick={() => act('accept', () => api.accept(order.id))}
            >
              قبول الطلب
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => setRejecting(true)}>
              رفض الطلب
            </Button>
          </div>
        )}

        {rejecting && (
          <div className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4">
            <label className="block text-sm font-medium text-slate-700">سبب الرفض (مطلوب)</label>
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: المنتجات غير متوفرة"
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                className="flex-1"
                loading={busy === 'reject'}
                onClick={() => act('reject', () => api.reject(order.id, reason.trim()))}
              >
                تأكيد الرفض
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setRejecting(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        )}

        {order.status === 'SHOP_ACCEPTED' && (
          <Button
            className="w-full"
            loading={busy === 'prepare'}
            onClick={() => act('prepare', () => api.prepare(order.id))}
          >
            بدء التحضير
          </Button>
        )}

        {order.status === 'PREPARING' && (
          <Button
            className="w-full"
            loading={busy === 'ready'}
            onClick={() => act('ready', () => api.ready(order.id))}
          >
            الطلب جاهز للاستلام
          </Button>
        )}

        {order.status === 'NO_DRIVER' && (
          <Button
            className="w-full"
            loading={busy === 'retry'}
            onClick={() => act('retry', () => api.retryDispatch(order.id))}
          >
            إعادة البحث عن موصّل
          </Button>
        )}
      </div>
    </div>
  );
}
