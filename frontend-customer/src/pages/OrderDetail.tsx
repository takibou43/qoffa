import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Alert, Button, ErrorState, LoadingBlock, StatusBadge } from '../components/ui';
import { ApiError, api } from '../lib/api';
import {
  HAPPY_PATH,
  STATUS_LABEL,
  formatDateTime,
  formatDistance,
  formatDzd,
  isActiveOrder,
  mapsUrl,
  telUrl,
} from '../lib/format';
import type { Order, OrderStatus } from '../lib/types';
import { OrderQr } from '../components/OrderQr';
import { ProductImage } from '../components/ProductImage';
import { orderItemImage } from '../lib/images';

/** الخط الزمني يعرض الحالات كما يرسلها الخادم — لا منطق انتقال هنا */
function Timeline({ status }: { status: OrderStatus }) {
  const currentIndex = HAPPY_PATH.indexOf(status);
  const offPath = currentIndex === -1;

  if (offPath) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <StatusBadge status={status} />
      </div>
    );
  }

  return (
    <ol className="rounded-2xl border border-slate-200 bg-white p-4">
      {HAPPY_PATH.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                  done
                    ? 'bg-brand-600 text-white'
                    : current
                      ? 'bg-brand-700 text-white ring-4 ring-brand-100'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? '✓' : index + 1}
              </span>
              {index < HAPPY_PATH.length - 1 && (
                <span className={`w-0.5 flex-1 ${done ? 'bg-brand-500' : 'bg-slate-200'}`} />
              )}
            </div>
            <span
              className={`pb-4 text-sm ${
                current ? 'font-bold text-slate-900' : done ? 'text-slate-600' : 'text-slate-400'
              }`}
            >
              {STATUS_LABEL[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ReviewForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const reviewed = new Set(order.reviews.map((r) => r.targetType));
  const [shopRating, setShopRating] = useState(0);
  const [driverRating, setDriverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needShop = !reviewed.has('SHOP');
  const needDriver = Boolean(order.driver) && !reviewed.has('DRIVER');

  if (!needShop && !needDriver) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">✓ شكرًا، تم تسجيل تقييمك لهذا الطلب.</p>
      </div>
    );
  }

  async function submit() {
    setError(null);
    if (needShop && shopRating === 0) {
      setError('اختر تقييم المحل من 1 إلى 5.');
      return;
    }
    if (needDriver && driverRating === 0) {
      setError('اختر تقييم الموصّل من 1 إلى 5.');
      return;
    }

    setSubmitting(true);
    try {
      await api.reviewOrder(order.id, {
        ...(needShop ? { shop: { rating: shopRating, comment: comment.trim() || null } } : {}),
        ...(needDriver ? { driver: { rating: driverRating } } : {}),
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر إرسال التقييم.');
    } finally {
      setSubmitting(false);
    }
  }

  const Stars = ({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) => (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-700">{label}</p>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            aria-label={`${n} من 5`}
            className={`grid size-11 place-items-center rounded-xl text-2xl transition ${
              n <= value ? 'bg-amber-50' : 'bg-slate-50'
            }`}
          >
            <span className={n <= value ? '' : 'opacity-30'}>⭐</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">قيّم تجربتك</h2>
      {needShop && <Stars value={shopRating} onChange={setShopRating} label={`المحل: ${order.shop.name}`} />}
      {needDriver && (
        <Stars value={driverRating} onChange={setDriverRating} label={`الموصّل: ${order.driver!.user.fullName}`} />
      )}
      {needShop && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={400}
          placeholder="تعليق اختياري…"
          className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-brand-600"
        />
      )}
      {error && <Alert>{error}</Alert>}
      <Button className="w-full" onClick={submit} loading={submitting}>
        إرسال التقييم
      </Button>
    </div>
  );
}

export default function OrderDetail() {
  const { orderId = '' } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  // تحديث دوري خفيف ما دام الطلب نشطًا
  useEffect(() => {
    if (!order || !isActiveOrder(order.status)) return;
    const timer = setInterval(() => load(true), 15_000);
    return () => clearInterval(timer);
  }, [order, load]);

  if (loading) return <LoadingBlock />;
  if (error || !order) return <ErrorState message={error ?? 'الطلب غير موجود'} />;

  const canCancel = order.status === 'PENDING' || order.status === 'SHOP_ACCEPTED';

  async function cancel() {
    setActionError(null);
    setCancelling(true);
    try {
      await api.cancelOrder(orderId);
      await load(true);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'تعذّر إلغاء الطلب.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="pb-6">
      <PageHeader
        title={`طلب ${order.code}`}
        subtitle={formatDateTime(order.createdAt)}
        action={
          <Link to="/orders" className="text-sm text-brand-700">
            طلباتي
          </Link>
        }
      />

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-4">
          <span className="text-sm text-slate-600">حالة الطلب</span>
          <StatusBadge status={order.status} />
        </div>

        {order.status === 'REJECTED' && order.rejectionReason && (
          <Alert>سبب الرفض: {order.rejectionReason}</Alert>
        )}
        {order.status === 'NO_DRIVER' && (
          <Alert kind="info">
            لم نجد موصّلًا متاحًا بعد. المحل يعيد المحاولة تلقائيًا — طلبك لم يُلغَ.
          </Alert>
        )}
        {order.status === 'FAILED_DELIVERY' && (
          <Alert>تعذّر تسليم الطلب. سيتواصل معك فريق المنصة.</Alert>
        )}

        <Timeline status={order.status} />

        {order.deliveryQr && (
          <OrderQr
            payload={order.deliveryQr}
            code={order.code}
            title="رمز تسليم طلبيتك"
            hint="اعرض هذا الرمز على الموصّل عند وصوله ليتحقق أنها طلبيتك. لا تشاركه مع أحد غيره."
            verifiedAt={order.deliveryVerifiedAt}
            verifiedLabel="تحقق الموصّل من طلبيتك"
          />
        )}

        {/* المحل */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-900">المحل</h2>
          <p className="text-sm text-slate-700">{order.shop.name}</p>
          <p className="text-xs text-slate-500">{order.shop.addressLine}</p>
          <div className="mt-3 flex gap-2">
            <a href={telUrl(order.shop.phone)} className="flex-1">
              <Button variant="secondary" className="w-full">
                📞 اتصال بالمحل
              </Button>
            </a>
            <a
              href={mapsUrl(order.shop.latitude, order.shop.longitude)}
              target="_blank"
              rel="noreferrer"
              className="flex-1"
            >
              <Button variant="secondary" className="w-full">
                🗺️ الخريطة
              </Button>
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
              <Button variant="secondary" className="w-full">
                📞 اتصال بالموصّل
              </Button>
            </a>
          </section>
        )}

        {/* عنوان التسليم */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-900">عنوان التسليم</h2>
          <p className="text-sm text-slate-700">{order.deliveryAddressLine}</p>
          <p className="text-xs text-slate-500">{order.deliveryCity}</p>
          {order.distanceMeters !== null && (
            <p className="mt-1 text-xs text-slate-500">
              المسافة التقريبية من المحل: {formatDistance(order.distanceMeters)}
            </p>
          )}
          {order.customerNote && (
            <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
              ملاحظتك: {order.customerNote}
            </p>
          )}
        </section>

        {/* المنتجات */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-900">المنتجات</h2>
          <ul className="space-y-2 text-sm">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <ProductImage src={orderItemImage(item)} className="size-9 rounded-lg" />
                  <span className="min-w-0 truncate text-slate-700">
                    {item.nameSnapshot} × {item.quantity}
                  </span>
                </span>
                <span className="shrink-0 text-slate-600">{formatDzd(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>المنتجات</dt>
              <dd>{formatDzd(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-slate-600">
              <dt>التوصيل</dt>
              <dd>{formatDzd(order.deliveryFee)}</dd>
            </div>
            <div className="flex justify-between text-base font-bold text-slate-900">
              <dt>الإجمالي (دفع عند الاستلام)</dt>
              <dd>{formatDzd(order.total)}</dd>
            </div>
          </dl>
        </section>

        {order.status === 'DELIVERED' && <ReviewForm order={order} onDone={() => load(true)} />}

        {actionError && <Alert>{actionError}</Alert>}

        {canCancel && (
          <Button variant="danger" className="w-full" onClick={cancel} loading={cancelling}>
            إلغاء الطلب
          </Button>
        )}
      </div>
    </div>
  );
}
