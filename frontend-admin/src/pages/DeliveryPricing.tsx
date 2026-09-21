import { useEffect, useMemo, useState } from 'react';
import { PageTitle } from '../components/Layout';
import { Alert, Button, Field, LoadingBlock, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDzd } from '../lib/format';
import type { DeliveryPricing } from '../lib/types';

/** نصوص الحقول كما يكتبها المدير (تُحوَّل لأرقام عند الحفظ) */
type Draft = Record<keyof DeliveryPricing, string>;

const toDraft = (p: DeliveryPricing): Draft => ({
  baseFee: String(p.baseFee),
  baseKm: String(p.baseKm),
  perKmFee: String(p.perKmFee),
  maxKm: String(p.maxKm),
  roadFactor: String(p.roadFactor),
});

function parse(draft: Draft): { value: DeliveryPricing | null; error: string | null } {
  const n = {
    baseFee: Number(draft.baseFee),
    baseKm: Number(draft.baseKm),
    perKmFee: Number(draft.perKmFee),
    maxKm: Number(draft.maxKm),
    roadFactor: Number(draft.roadFactor),
  };
  if (Object.values(n).some((v) => draft.baseFee === '' || !Number.isFinite(v))) {
    return { value: null, error: 'أدخل أرقامًا صحيحة في كل الحقول.' };
  }
  if (!Number.isInteger(n.baseFee) || n.baseFee < 0 || n.baseFee > 20_000) {
    return { value: null, error: 'الرسم الأساسي عدد صحيح بين 0 و20000 دج.' };
  }
  if (!Number.isInteger(n.perKmFee) || n.perKmFee < 0 || n.perKmFee > 5_000) {
    return { value: null, error: 'سعر الكيلومتر عدد صحيح بين 0 و5000 دج.' };
  }
  if (n.baseKm < 0 || n.baseKm > 50) return { value: null, error: 'المسافة المشمولة بين 0 و50 كم.' };
  if (n.maxKm < 1 || n.maxKm > 100) return { value: null, error: 'أقصى مسافة بين 1 و100 كم.' };
  if (n.roadFactor < 1 || n.roadFactor > 2) {
    return { value: null, error: 'معامل الطريق بين 1 و2.' };
  }
  return { value: n, error: null };
}

/** نفس معادلة الخادم (services/deliveryPricing.ts) — للمعاينة فقط، الخادم هو المرجع عند الطلب */
function previewFee(p: DeliveryPricing, straightKm: number) {
  const distanceKm = Math.round((straightKm * 1000 * p.roadFactor) / 100) / 10;
  const extra = Math.max(0, distanceKm - p.baseKm);
  return {
    distanceKm,
    fee: Math.round(p.baseFee + Math.ceil(extra) * p.perKmFee),
    withinRange: distanceKm <= p.maxKm,
  };
}

export default function DeliveryPricingPage() {
  const { user } = useAuth();
  const canEdit = user?.role === 'SUPER_ADMIN';

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<DeliveryPricing | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .deliveryPricing()
      .then((r) => {
        setSaved(r.pricing);
        setDraft(toDraft(r.pricing));
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const parsed = useMemo(() => (draft ? parse(draft) : null), [draft]);
  const dirty = draft && saved ? JSON.stringify(draft) !== JSON.stringify(toDraft(saved)) : false;

  const sample = useMemo(() => {
    if (!parsed?.value) return [];
    const pricing = parsed.value;
    return [0.5, 1, 2, 3, 5, 8, 12].map((km) => ({ km, ...previewFee(pricing, km) }));
  }, [parsed]);

  async function save() {
    if (!parsed?.value) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const r = await api.setDeliveryPricing(parsed.value);
      setSaved(r.pricing);
      setDraft(toDraft(r.pricing));
      setNotice('تم حفظ أسعار التوصيل. تُطبَّق على الطلبات الجديدة فقط.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر حفظ الأسعار.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingBlock />;

  const fields: { key: keyof DeliveryPricing; label: string; hint: string; step?: string }[] = [
    { key: 'baseFee', label: 'الرسم الأساسي (دج)', hint: 'يغطي أول كيلومترات التوصيل' },
    { key: 'baseKm', label: 'المسافة المشمولة بالرسم الأساسي (كم)', hint: 'مثال: 2', step: '0.1' },
    { key: 'perKmFee', label: 'سعر كل كيلومتر إضافي (دج)', hint: 'يُحتسب الكيلومتر أو جزء منه' },
    { key: 'maxKm', label: 'أقصى مسافة توصيل (كم)', hint: 'ما فوقها لا يُقبل الطلب', step: '0.5' },
    {
      key: 'roadFactor',
      label: 'معامل مسافة الطريق',
      hint: 'يحوّل المسافة المستقيمة إلى مسافة طريق تقريبية (المعتاد 1.3)',
      step: '0.05',
    },
  ];

  return (
    <div>
      <PageTitle
        title="أسعار التوصيل"
        subtitle="السعر يُحسب تلقائيًا حسب المسافة من المحل إلى عنوان الزبون. الإدارة وحدها تحدد هذه المعاملات."
      />

      {!canEdit && (
        <div className="mb-3">
          <Alert kind="info">التعديل متاح لمالك المنصة فقط. يمكنك الاطلاع على الأسعار الحالية.</Alert>
        </div>
      )}
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {notice && <div className="mb-3"><Alert kind="success">{notice}</Alert></div>}

      {draft && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-bold text-slate-900">المعاملات</h3>
            {fields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={f.step ?? '1'}
                  disabled={!canEdit}
                  className={inputClass}
                  value={draft[f.key]}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              </Field>
            ))}

            {parsed?.error && <Alert>{parsed.error}</Alert>}

            {canEdit && (
              <div className="flex gap-2 pt-1">
                <Button onClick={save} loading={saving} disabled={!dirty || !parsed?.value}>
                  حفظ الأسعار
                </Button>
                {dirty && saved && (
                  <Button variant="secondary" onClick={() => setDraft(toDraft(saved))}>
                    تراجع
                  </Button>
                )}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-bold text-slate-900">معاينة الأسعار</h3>
            <p className="mb-3 text-xs text-slate-500">
              تتحدث فورًا مع ما تكتبه (قبل الحفظ). المسافة هنا مستقيمة بين المحل والزبون.
            </p>
            {sample.length === 0 ? (
              <p className="text-sm text-slate-500">صحّح القيم لتظهر المعاينة.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-right text-xs text-slate-500">
                    <th className="py-2 font-medium">مسافة مستقيمة</th>
                    <th className="py-2 font-medium">مسافة الطريق</th>
                    <th className="py-2 font-medium">رسم التوصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {sample.map((row) => (
                    <tr key={row.km} className="border-b border-slate-100 last:border-0">
                      <td className="py-2">{row.km} كم</td>
                      <td className="py-2 text-slate-600">{row.distanceKm} كم</td>
                      <td className="py-2 font-semibold">
                        {row.withinRange ? (
                          formatDzd(row.fee)
                        ) : (
                          <span className="text-red-600">خارج النطاق</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
