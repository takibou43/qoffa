import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Alert, Button, EmptyState, ErrorState, LoadingBlock } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDistance, formatDzd, timeAgo } from '../lib/format';
import type { DriverProfile, Offer } from '../lib/types';

const STATUS_HINT: Record<string, string> = {
  PENDING: 'حسابك قيد المراجعة من إدارة المنصة. لن تصلك طلبات حتى يُعتمد.',
  REJECTED: 'طلب تسجيلك مرفوض. تواصل مع إدارة المنصة.',
  SUSPENDED: 'حسابك معلّق حاليًا. تواصل مع إدارة المنصة.',
};

function secondsLeft(expiresAt: string) {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export default function Home() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [hasCurrent, setHasCurrent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [p, o, c] = await Promise.all([
        api.profile(),
        api.offers().catch(() => ({ items: [] as Offer[] })),
        api.current().catch(() => ({ order: null })),
      ]);
      setProfile(p.driver);
      setOffers(o.items);
      setHasCurrent(Boolean(c.order));
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

  // تحديث العروض دوريًا + عدّاد المهلة كل ثانية
  useEffect(() => {
    const poll = setInterval(() => load(true), 10_000);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  async function toggleAvailability() {
    if (!profile) return;
    setActionError(null);
    setToggling(true);

    const finish = async (coords?: { latitude: number; longitude: number }) => {
      try {
        const r = await api.setAvailability(!profile.isAvailable, coords);
        setProfile(r.driver);
        await load(true);
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : 'تعذّر تغيير الحالة');
      } finally {
        setToggling(false);
      }
    };

    // عند التفعيل نُرسل الموقع لتحسين ترتيب العروض — وإن رُفض الإذن نُكمل بدونه
    if (!profile.isAvailable && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (p) => finish({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
        () => finish(),
        { timeout: 8000 },
      );
    } else {
      finish();
    }
  }

  async function respond(orderId: string, accept: boolean) {
    setActionError(null);
    setBusy(orderId);
    try {
      if (accept) {
        await api.acceptOffer(orderId);
        navigate('/delivery');
        return;
      }
      await api.declineOffer(orderId);
      await load(true);
    } catch (e) {
      // 409 = سبقك موصّل آخر أو انتهت المهلة (الحماية في الخادم)
      setActionError(e instanceof ApiError ? e.message : 'تعذّر تنفيذ العملية');
      await load(true);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <LoadingBlock />;
  if (error && !profile) return <ErrorState message={error} onRetry={() => load()} />;
  if (!profile) return null;

  const approved = profile.status === 'APPROVED';

  return (
    <div>
      <PageHeader title="طلبات التوصيل" />

      <div className="space-y-4 px-4 py-4">
        {!approved && <Alert kind="info">{STATUS_HINT[profile.status]}</Alert>}
        {actionError && <Alert>{actionError}</Alert>}

        {/* مفتاح التوفر */}
        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
          <div>
            <p className="text-sm font-bold text-slate-900">
              {profile.isAvailable ? '🟢 متاح' : '⚪ غير متاح'}
            </p>
            <p className="text-xs text-slate-500">
              {profile.isAvailable ? 'ستصلك عروض التوصيل القريبة' : 'لن تصلك أي عروض'}
            </p>
          </div>
          <Button
            variant={profile.isAvailable ? 'secondary' : 'primary'}
            onClick={toggleAvailability}
            loading={toggling}
            disabled={!approved}
          >
            {profile.isAvailable ? 'إيقاف التوفر' : 'تفعيل التوفر'}
          </Button>
        </div>

        {hasCurrent && (
          <button
            type="button"
            onClick={() => navigate('/delivery')}
            className="w-full rounded-2xl border border-brand-200 bg-brand-50 p-4 text-right active:scale-[0.99]"
          >
            <p className="text-sm font-bold text-brand-800">لديك طلب جارٍ — اضغط لمتابعته</p>
          </button>
        )}

        <section>
          <h2 className="mb-2 text-sm font-bold text-slate-900">
            العروض المتاحة {offers.length > 0 && `(${offers.length})`}
          </h2>

          {offers.length === 0 ? (
            <EmptyState
              icon="📋"
              title="لا توجد عروض الآن"
              description={
                !approved
                  ? 'حسابك غير مفعّل بعد.'
                  : profile.isAvailable
                    ? 'ستصلك العروض تلقائيًا فور جهوز طلب قريب منك.'
                    : 'فعّل التوفر لاستقبال العروض.'
              }
            />
          ) : (
            <div className="space-y-3">
              {offers.map((offer) => {
                const left = secondsLeft(offer.expiresAt);
                return (
                  <div
                    key={offer.id}
                    className="rounded-2xl border border-brand-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-900">{offer.order.shop.name}</h3>
                        <p className="text-xs text-slate-500">
                          {offer.order.code} · {timeAgo(offer.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                          left > 15 ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {left > 0 ? `${left} ث` : 'انتهت'}
                      </span>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-slate-500">المسافة إلى المحل</dt>
                        <dd className="font-medium">{formatDistance(offer.distanceMeters) ?? '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">المحل ← الزبون</dt>
                        <dd className="font-medium">
                          {formatDistance(offer.order.distanceMeters) ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">قيمة الطلب</dt>
                        <dd className="font-medium">{formatDzd(offer.order.total)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">رسوم التوصيل</dt>
                        <dd className="font-medium">{formatDzd(offer.order.deliveryFee)}</dd>
                      </div>
                    </dl>

                    <p className="mt-2 text-xs text-slate-500">
                      📍 {offer.order.deliveryAddressLine}، {offer.order.deliveryCity}
                    </p>

                    <div className="mt-3 flex gap-2">
                      <Button
                        className="flex-1"
                        loading={busy === offer.order.id}
                        disabled={left === 0 || hasCurrent}
                        onClick={() => respond(offer.order.id, true)}
                      >
                        قبول
                      </Button>
                      <Button
                        variant="secondary"
                        className="flex-1"
                        disabled={busy === offer.order.id}
                        onClick={() => respond(offer.order.id, false)}
                      >
                        رفض
                      </Button>
                    </div>
                    {hasCurrent && (
                      <p className="mt-2 text-xs text-amber-700">
                        لا يمكن قبول طلب جديد قبل إنهاء طلبك الحالي.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
