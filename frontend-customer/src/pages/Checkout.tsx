import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Alert, Button, Field, LoadingBlock, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/cart';
import { formatDzd } from '../lib/format';
import { useLocation as useGeo } from '../lib/location';
import type { Address } from '../lib/types';

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function Checkout() {
  const cart = useCart();
  const { user } = useAuth();
  const { coords, status, request } = useGeo();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ addressLine: '', city: '' });
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // مفتاح ثابت لهذه العملية: الضغط المزدوج أو إعادة المحاولة بعد انقطاع الشبكة لا ينشئ طلبًا ثانيًا
  const requestIdRef = useRef(newRequestId());
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{
    distanceKm: number;
    fee: number;
    withinRange: boolean;
    maxKm: number;
  } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    api
      .addresses()
      .then((r) => {
        setAddresses(r.items);
        setSelectedId(r.defaultAddressId ?? r.items[0]?.id ?? null);
        if (r.items.length === 0) setManual(true);
      })
      .catch(() => setManual(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (cart.lines.length === 0) navigate('/cart', { replace: true });
  }, [cart.lines.length, navigate]);

  // إحداثيات العنوان المختار (محفوظ أو موقع الجهاز عند الإدخال اليدوي)
  const target = manual
    ? coords
      ? { lat: coords.lat, lon: coords.lon }
      : null
    : (() => {
        const a = addresses.find((x) => x.id === selectedId);
        return a ? { lat: a.latitude, lon: a.longitude } : null;
      })();
  const targetLat = target?.lat;
  const targetLon = target?.lon;
  const shopId = cart.shopId;

  // سعر التوصيل يحسبه الخادم حسب المسافة — نعرضه كما يعود منه
  useEffect(() => {
    if (!shopId || targetLat === undefined || targetLon === undefined) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoteError(null);
    api
      .quoteDelivery(shopId, targetLat, targetLon)
      .then((r) => {
        if (!cancelled) setQuote(r.quote);
      })
      .catch((e) => {
        if (cancelled) return;
        setQuote(null);
        setQuoteError(e instanceof ApiError ? e.message : 'تعذّر حساب سعر التوصيل.');
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, targetLat, targetLon]);

  if (loading) return <LoadingBlock />;

  const outOfRange = quote !== null && !quote.withinRange;
  const total = cart.subtotal + (quote?.fee ?? 0);

  async function submit() {
    setError(null);

    if (outOfRange) {
      setError(`عنوانك خارج نطاق التوصيل (الحد الأقصى ${quote!.maxKm} كم).`);
      return;
    }

    if (manual) {
      if (form.addressLine.trim().length < 5) {
        setError('اكتب عنوانًا واضحًا (5 أحرف على الأقل).');
        return;
      }
      if (form.city.trim().length < 2) {
        setError('اكتب اسم المدينة أو البلدية.');
        return;
      }
      if (!coords) {
        setError('نحتاج موقعك التقريبي لإيصال الطلب. اضغط «تحديد موقعي» أو اختر عنوانًا محفوظًا.');
        return;
      }
    } else if (!selectedId) {
      setError('اختر عنوان التسليم.');
      return;
    }

    setSubmitting(true);
    try {
      const { order } = await api.createOrder({
        shopId: cart.shopId!,
        items: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        ...(manual
          ? {
              address: {
                addressLine: form.addressLine.trim(),
                city: form.city.trim(),
                latitude: coords!.lat,
                longitude: coords!.lon,
              },
            }
          : { addressId: selectedId! }),
        customerNote: note.trim() || null,
        clientRequestId: requestIdRef.current,
      });

      cart.clear();
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر إنشاء الطلب. حاول مجددًا.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pb-32">
      <PageHeader title="تأكيد الطلب" subtitle={cart.shopName ?? undefined} />

      <div className="space-y-4 px-4 py-4">
        {/* بيانات الزبون */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-900">بياناتك</h2>
          <p className="text-sm text-slate-700">{user?.fullName}</p>
          <p className="text-sm text-slate-500">{user?.phone}</p>
        </section>

        {/* العنوان */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-900">عنوان التسليم</h2>

          {addresses.length > 0 && (
            <div className="mb-3 space-y-2">
              {addresses.map((address) => (
                <label
                  key={address.id}
                  className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 ${
                    !manual && selectedId === address.id
                      ? 'border-brand-600 bg-brand-50'
                      : 'border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="address"
                    checked={!manual && selectedId === address.id}
                    onChange={() => {
                      setManual(false);
                      setSelectedId(address.id);
                    }}
                    className="mt-0.5 size-4 accent-brand-700"
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-medium text-slate-800">{address.label}</span>
                    <span className="block text-slate-500">
                      {address.addressLine}، {address.city}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="radio"
              name="address"
              checked={manual}
              onChange={() => setManual(true)}
              className="size-4 accent-brand-700"
            />
            <span className="font-medium text-slate-800">إدخال عنوان جديد</span>
          </label>

          {manual && (
            <div className="mt-3 space-y-3">
              <Field label="العنوان">
                <input
                  className={inputClass}
                  value={form.addressLine}
                  onChange={(e) => setForm({ ...form, addressLine: e.target.value })}
                  placeholder="مثال: حي السلام، عمارة 4، الطابق 2"
                />
              </Field>
              <Field label="المدينة / البلدية">
                <input
                  className={inputClass}
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  placeholder="مثال: باب الزوار"
                />
              </Field>

              <div className="rounded-xl bg-slate-50 p-3 text-sm">
                {coords ? (
                  <p className="text-brand-700">✓ تم تحديد موقعك التقريبي</p>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-slate-600">نحتاج موقعك ليصل الموصّل إليك</span>
                    <Button variant="secondary" onClick={request} loading={status === 'loading'}>
                      تحديد موقعي
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ملخص الطلب */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-900">ملخص الطلب</h2>
          <ul className="space-y-2 text-sm">
            {cart.lines.map((line) => (
              <li key={line.productId} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-slate-700">
                  {line.name} × {line.quantity}
                </span>
                <span className="shrink-0 text-slate-600">{formatDzd(line.price * line.quantity)}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>المنتجات</dt>
              <dd>{formatDzd(cart.subtotal)}</dd>
            </div>
            <div className="flex justify-between text-slate-600">
              <dt>
                التوصيل
                {quote && quote.withinRange && (
                  <span className="text-xs text-slate-400"> · {quote.distanceKm} كم</span>
                )}
              </dt>
              <dd>
                {quote ? (
                  quote.withinRange ? (
                    formatDzd(quote.fee)
                  ) : (
                    <span className="text-red-600">خارج النطاق</span>
                  )
                ) : (
                  <span className="text-xs">يظهر بعد اختيار العنوان</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between text-base font-bold text-slate-900">
              <dt>الإجمالي</dt>
              <dd>{formatDzd(total)}</dd>
            </div>
          </dl>
        </section>

        {/* ملاحظة وطريقة الدفع */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <Field label="ملاحظة للمحل (اختياري)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder="مثال: الرجاء الاتصال عند الوصول"
              className={`${inputClass} py-2.5`}
            />
          </Field>

          <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
            💵 الدفع عند الاستلام نقدًا
          </div>
        </section>

        {outOfRange && (
          <Alert>عنوانك خارج نطاق التوصيل لهذا المحل (الحد الأقصى {quote!.maxKm} كم).</Alert>
        )}
        {quoteError && <Alert>{quoteError}</Alert>}
        {error && <Alert>{error}</Alert>}
      </div>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] z-20 pb-3 mx-auto w-full max-w-2xl border-t border-slate-200 bg-white px-4 pt-3">
        <Button className="w-full" onClick={submit} loading={submitting} disabled={outOfRange}>
          تأكيد الطلب · {formatDzd(total)}
        </Button>
      </div>
    </div>
  );
}
