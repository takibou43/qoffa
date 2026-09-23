import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
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
import type { CurrentOrder, Settlement } from '../lib/types';

export default function Delivery() {
  const [order, setOrder] = useState<CurrentOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  /** ما الذي تمسحه الكاميرا الآن: QR الطلبية في المحل أو QR الزبون عند التسليم */
  const [scanning, setScanning] = useState<null | 'pickup' | 'deliver'>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pin, setPin] = useState('');

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

  async function act(name: string, fn: () => Promise<unknown>, done?: string) {
    setError(null);
    setScanError(null);
    setSuccess(null);
    setBusy(name);
    try {
      await fn();
      if (done) setSuccess(done);
      await load(true);
      setFailing(false);
      setPin('');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'تعذّر تنفيذ العملية.';
      if (name === 'pickup' || name === 'deliver') setScanError(msg);
      else setError(msg);
    } finally {
      setBusy(null);
    }
  }

  /** الخادم يتحقق من الرمز ومن أنك الموصّل المعيَّن، ويسجّل الاستلام/التسليم مرة واحدة فقط */
  function handleScan(payload: string) {
    const mode = scanning;
    setScanning(null);
    if (!order || !mode) return;
    if (mode === 'pickup') {
      void act('pickup', () => api.pickup(order.id, payload), '✓ تم استلام الطلب من المحل — الطلب الآن في الطريق إلى الزبون');
    } else {
      void act('deliver', () => api.deliver(order.id, { payload }), '✓ تم تسليم الطلب بنجاح');
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
        {success && <Alert kind="success">{success}</Alert>}

        {/* الحساب المالي — واضح في كل مرحلة حتى لا يختلط */}
        <MoneyCard settlement={order.settlement} beforePickup={beforePickup} />

        {/* الاستلام من المحل: مسح QR الطلبية إلزامي */}
        {order.status === 'DRIVER_ASSIGNED' && (
          <section className="space-y-3 rounded-2xl border-2 border-brand-300 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">استلام الطلب من المحل</h2>
              <span dir="ltr" className="font-mono text-lg font-bold tracking-widest text-slate-900">
                {order.code}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              اطلب من المحل عرض رمز QR الخاص بالطلب {order.code} وامسحه. ادفع للمحل{' '}
              <b>{formatDzd(order.settlement.driverPaysShop)}</b> ثم خذ الطلبية.
            </p>
            {scanError && <Alert>{scanError}</Alert>}
            {isQrScanSupported() ? (
              <Button className="w-full" loading={busy === 'pickup'} onClick={() => setScanning('pickup')}>
                📷 مسح QR الطلبية للاستلام
              </Button>
            ) : (
              <Alert kind="info">
                الكاميرا غير متاحة في هذا المتصفح. افتح التطبيق في Chrome أو Safari للمسح.
              </Alert>
            )}
          </section>
        )}

        {scanning && (
          <QrScanner
            title={scanning === 'pickup' ? 'وجّه الكاميرا نحو رمز الطلبية في المحل' : 'وجّه الكاميرا نحو رمز الزبون'}
            onDetected={handleScan}
            onClose={() => setScanning(null)}
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
        </section>

        {/* الخطوة التالية */}
        {order.status === 'DRIVER_ASSIGNED' && (
          <Button
            variant="secondary"
            className="w-full"
            loading={busy === 'release'}
            onClick={() => act('release', () => api.release(order.id))}
          >
            الانسحاب من الطلب
          </Button>
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
          <section className="space-y-3 rounded-2xl border-2 border-brand-300 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-900">تأكيد التسليم للزبون</h2>
            <p className="text-xs text-slate-500">
              اقبض من الزبون <b>{formatDzd(order.settlement.driverCollectsFromCustomer)}</b>، ثم امسح رمز QR على
              هاتفه أو أدخل رمز التسليم (4 أرقام) الذي يعطيك إياه.
            </p>
            {scanError && <Alert>{scanError}</Alert>}
            {isQrScanSupported() && (
              <Button className="w-full" loading={busy === 'deliver'} onClick={() => setScanning('deliver')}>
                📷 مسح QR الزبون
              </Button>
            )}
            <div className="flex gap-2">
              <input
                className={`${inputClass} flex-1 text-center font-mono tracking-[0.5em]`}
                inputMode="numeric"
                maxLength={4}
                dir="ltr"
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
              <Button
                variant="secondary"
                disabled={pin.length !== 4}
                loading={busy === 'deliver'}
                onClick={() =>
                  act('deliver', () => api.deliver(order.id, { pin }), '✓ تم تسليم الطلب بنجاح')
                }
              >
                تأكيد برمز التسليم
              </Button>
            </div>
            <Button variant="danger" className="w-full" onClick={() => setFailing(true)}>
              تعذّر التسليم
            </Button>
          </section>
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

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** ما تدفعه للمحل، ما تقبضه من الزبون، وما يبقى معك */
function MoneyCard({ settlement, beforePickup }: { settlement: Settlement; beforePickup: boolean }) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
      <h2 className="font-bold text-slate-900">💵 الحساب</h2>
      <div className={`space-y-1 rounded-xl p-3 ${beforePickup ? 'bg-amber-50' : 'bg-slate-50'}`}>
        <p className="text-xs font-bold text-amber-800">عند المحل</p>
        <Row label="قيمة المنتجات التي تدفعها للمحل" value={formatDzd(settlement.driverPaysShop)} strong />
      </div>
      <div className={`space-y-1 rounded-xl p-3 ${beforePickup ? 'bg-slate-50' : 'bg-brand-50'}`}>
        <p className="text-xs font-bold text-brand-800">عند الزبون</p>
        <Row label="قيمة المنتجات" value={formatDzd(settlement.productsAmount)} />
        <Row label="رسوم التوصيل" value={formatDzd(settlement.deliveryFee)} />
        {settlement.discount > 0 && <Row label="الخصم" value={`− ${formatDzd(settlement.discount)}`} />}
        <Row label="المبلغ الذي تقبضه من الزبون" value={formatDzd(settlement.driverCollectsFromCustomer)} strong />
      </div>
      <div className="flex items-center justify-between rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800">
        <span>أجرة التوصيل التي تحتفظ بها</span>
        <span>{formatDzd(settlement.driverKeeps)}</span>
      </div>
    </section>
  );
}
