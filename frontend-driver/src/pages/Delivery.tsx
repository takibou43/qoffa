import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { OrderQr } from '../components/OrderQr';
import { QrScanner, isQrScanSupported } from '../components/QrScanner';
import {
  Alert,
  Button,
  EmptyState,
  LoadingBlock,
  StatusBadge,
  inputClass,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDistance, formatDzd, mapsUrl, telUrl } from '../lib/format';
import type { CurrentOrder, QrVerification } from '../lib/types';

export default function Delivery() {
  const [order, setOrder] = useState<CurrentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  const [scanning, setScanning] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<QrVerification | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return api
      .current()
      .then((r) => setOrder(r.order))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(name: string, fn: () => Promise<unknown>) {
    setError(null);
    setVerifyResult(null);
    setVerifyError(null);
    setBusy(name);
    try {
      await fn();
      await load(true);
      setFailing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تنفيذ العملية.');
    } finally {
      setBusy(null);
    }
  }

  /** التحقق فقط — الخادم يقرر صحة الرمز ولا يغيّر حالة الطلب */
  async function handleScan(payload: string) {
    setScanning(false);
    if (!order) return;
    setVerifyError(null);
    setVerifyResult(null);
    setVerifying(true);
    try {
      const result = await api.verifyQr(order.id, payload);
      setVerifyResult(result);
      await load(true);
    } catch (e) {
      setVerifyError(e instanceof ApiError ? e.message : 'تعذّر التحقق من الرمز. حاول مرة أخرى.');
    } finally {
      setVerifying(false);
    }
  }

  if (loading) return <LoadingBlock />;

  if (!order) {
    return (
      <>
        <PageHeader title="التوصيل الحالي" />
        <EmptyState
          icon="🛵"
          title="لا يوجد طلب جارٍ"
          description="اقبل عرضًا من صفحة الطلبات ليظهر هنا."
          action={
            <Link to="/">
              <Button>عرض الطلبات المتاحة</Button>
            </Link>
          }
        />
      </>
    );
  }

  // المرحلة الأولى: التوجه إلى المحل. بعد الاستلام: التوجه إلى الزبون.
  const beforePickup = order.status === 'DRIVER_ASSIGNED';

  return (
    <div className="pb-6">
      <PageHeader title={`طلب ${order.code}`} subtitle={formatDzd(order.total)} />

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
          <span className="text-sm text-slate-600">حالة الطلب</span>
          <StatusBadge status={order.status} />
        </div>

        {error && <Alert>{error}</Alert>}

        {/* التحقق بالـQR: في المحل (رمز الاستلام) ثم عند الزبون (رمز التسليم) */}
        {(() => {
          const verifiedAt = beforePickup ? order.pickupVerifiedAt : order.deliveryVerifiedAt;
          return (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900">
                  {beforePickup ? 'التحقق عند الاستلام' : 'التحقق عند التسليم'}
                </h2>
                <span dir="ltr" className="font-mono text-lg font-bold tracking-widest text-slate-900">
                  {order.code}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {beforePickup
                  ? 'امسح رمز QR المعروض في المحل للتأكد أنك تأخذ الطلبية الصحيحة.'
                  : 'امسح رمز QR على هاتف الزبون للتأكد أنك تسلّم الطلبية لصاحبها.'}
              </p>
              {verifiedAt && (
                <p className="rounded-lg bg-emerald-50 p-2 text-sm font-bold text-emerald-700">
                  ✓ تم التحقق من الطلبية
                </p>
              )}
              {verifyResult && (
                <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                  <p className="font-bold">
                    ✓ الرمز صحيح — طلب {verifyResult.order.code}
                  </p>
                  <p className="text-xs">
                    {verifyResult.order.itemsCount} قطعة • {formatDzd(verifyResult.order.total)}
                  </p>
                </div>
              )}
              {verifyError && <Alert>{verifyError}</Alert>}
              {isQrScanSupported() ? (
                <Button
                  variant={verifiedAt ? 'secondary' : 'primary'}
                  className="w-full"
                  loading={verifying}
                  onClick={() => setScanning(true)}
                >
                  📷 {beforePickup ? 'مسح QR المحل' : 'مسح QR الزبون'}
                </Button>
              ) : (
                <p className="text-xs text-amber-700">
                  الكاميرا غير متاحة في هذا المتصفح. طابق رقم الطلب يدويًا.
                </p>
              )}
            </section>
          );
        })()}

        {scanning && (
          <QrScanner
            title={beforePickup ? 'وجّه الكاميرا نحو رمز المحل' : 'وجّه الكاميرا نحو رمز الزبون'}
            onDetected={handleScan}
            onClose={() => setScanning(false)}
          />
        )}

        {/* الوجهة الحالية أولًا */}
        {beforePickup ? (
          <section className="rounded-2xl border-2 border-brand-300 bg-white p-4">
            <p className="mb-1 text-xs font-bold text-brand-700">الوجهة الحالية — استلام</p>
            <h2 className="text-base font-bold text-slate-900">{order.shop.name}</h2>
            <p className="text-sm text-slate-600">{order.shop.addressLine}</p>
            <p className="text-xs text-slate-500">{order.shop.city}</p>
            <div className="mt-3 flex gap-2">
              <a href={telUrl(order.shop.phone)} className="flex-1">
                <Button variant="secondary" className="w-full">📞 اتصال بالمحل</Button>
              </a>
              <a
                href={mapsUrl(order.shop.latitude, order.shop.longitude)}
                target="_blank"
                rel="noreferrer"
                className="flex-1"
              >
                <Button variant="secondary" className="w-full">🗺️ فتح GPS</Button>
              </a>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border-2 border-brand-300 bg-white p-4">
            <p className="mb-1 text-xs font-bold text-brand-700">الوجهة الحالية — تسليم</p>
            <h2 className="text-base font-bold text-slate-900">{order.customer?.fullName}</h2>
            <p className="text-sm text-slate-600">{order.deliveryAddressLine}</p>
            <p className="text-xs text-slate-500">{order.deliveryCity}</p>
            {order.distanceMeters !== null && (
              <p className="mt-1 text-xs text-slate-500">
                المسافة من المحل: {formatDistance(order.distanceMeters)}
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
                <Button variant="secondary" className="w-full">🗺️ فتح GPS</Button>
              </a>
            </div>
          </section>
        )}

        {/* الطرف الآخر للمرجع */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-900">
            {beforePickup ? 'الزبون (بعد الاستلام)' : 'المحل'}
          </h2>
          {beforePickup ? (
            <>
              <p className="text-sm text-slate-700">{order.customer?.fullName}</p>
              <p className="text-xs text-slate-500">{order.deliveryAddressLine}، {order.deliveryCity}</p>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-700">{order.shop.name}</p>
              <p className="text-xs text-slate-500">{order.shop.addressLine}</p>
            </>
          )}
        </section>

        {beforePickup && (
          <details className="rounded-2xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-900">
              عرض رمز استلام الطلبية
            </summary>
            <div className="mt-3">
              <OrderQr
                payload={order.pickupQr}
                code={order.code}
                title="رمز استلام الطلبية"
                hint="نفس الرمز المعروض لدى المحل — للمطابقة عند الاستلام."
              />
            </div>
          </details>
        )}

        {/* محتوى الطلب */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-900">محتوى الطلب</h2>
          <ul className="space-y-1 text-sm text-slate-700">
            {order.items.map((item, i) => (
              <li key={i}>
                <span className="font-bold text-brand-700">{item.quantity}×</span> {item.nameSnapshot}
              </li>
            ))}
          </ul>
          <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm font-bold text-brand-800">
            💵 تحصيل نقدًا عند التسليم: {formatDzd(order.total)}
          </div>
        </section>

        {/* الخطوة التالية */}
        {order.status === 'DRIVER_ASSIGNED' && (
          <>
            <Button
              className="w-full"
              loading={busy === 'pickup'}
              onClick={() => act('pickup', () => api.pickup(order.id))}
            >
              استلمت الطلب من المحل
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              loading={busy === 'release'}
              onClick={() => act('release', () => api.release(order.id))}
            >
              الانسحاب من الطلب
            </Button>
          </>
        )}

        {order.status === 'PICKED_UP' && (
          <Button
            className="w-full"
            loading={busy === 'out'}
            onClick={() => act('out', () => api.outForDelivery(order.id))}
          >
            انطلقت إلى الزبون
          </Button>
        )}

        {order.status === 'OUT_FOR_DELIVERY' && !failing && (
          <>
            <Button
              className="w-full"
              loading={busy === 'deliver'}
              onClick={() => act('deliver', () => api.deliver(order.id))}
            >
              تم التسليم
            </Button>
            <Button variant="danger" className="w-full" onClick={() => setFailing(true)}>
              تعذّر التسليم
            </Button>
          </>
        )}

        {(order.status === 'PICKED_UP' || order.status === 'OUT_FOR_DELIVERY') && failing && (
          <div className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-4">
            <label className="block text-sm font-medium text-slate-700">سبب تعذّر التسليم</label>
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثال: الزبون لا يرد"
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                className="flex-1"
                loading={busy === 'fail'}
                onClick={() => act('fail', () => api.failDelivery(order.id, reason.trim()))}
              >
                تأكيد
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setFailing(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        )}

        {order.status === 'PICKED_UP' && !failing && (
          <button
            type="button"
            onClick={() => setFailing(true)}
            className="w-full py-2 text-sm text-red-600"
          >
            تعذّر التسليم
          </button>
        )}
      </div>
    </div>
  );
}
