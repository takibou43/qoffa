import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { PageHeader } from '../components/Layout';
import { Button, ErrorState, LoadingBlock } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDateTime, formatDzd } from '../lib/format';
import type { Invoice } from '../lib/types';

/** فاتورة الطلب — قابلة للطباعة. كل المبالغ يحسبها الخادم. */
export default function InvoicePage() {
  const { orderId = '' } = useParams();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .invoice(orderId)
      .then((r) => setInvoice(r.invoice))
      .catch((e: ApiError) => setError(e.message));
  }, [orderId]);

  useEffect(() => {
    if (!invoice) return;
    let alive = true;
    QRCode.toDataURL(invoice.qr, { errorCorrectionLevel: 'M', margin: 1, width: 320 })
      .then((url) => alive && setQrSrc(url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [invoice]);

  if (error) return <ErrorState message={error} />;
  if (!invoice) return <LoadingBlock />;

  return (
    <div className="pb-6">
      <div className="print:hidden">
        <PageHeader
          title="الفاتورة"
          subtitle={invoice.orderCode}
          action={
            <Link to={`/orders/${invoice.orderId}`} className="text-sm text-brand-700">
              الطلب
            </Link>
          }
        />
      </div>

      <div className="space-y-4 px-4 py-4">
        <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <header className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <p dir="ltr" className="text-right text-2xl font-black tracking-widest text-brand-700">
                QOFFA
              </p>
              <h1 className="text-base font-bold text-slate-900">{invoice.title}</h1>
              <p className="text-xs text-slate-500">التاريخ: {formatDateTime(invoice.date)}</p>
            </div>
            {qrSrc && <img src={qrSrc} alt={`رمز الطلب ${invoice.orderCode}`} className="size-24" />}
          </header>

          <section className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-bold text-slate-900">المحل</p>
              <p className="text-slate-700">{invoice.shop.name}</p>
              <p className="text-slate-500">{invoice.shop.address}</p>
              <p dir="ltr" className="text-right text-slate-500">{invoice.shop.phone}</p>
            </div>
            <div>
              <p className="font-bold text-slate-900">الزبون</p>
              <p className="text-slate-700">{invoice.customer.fullName}</p>
              <p className="text-slate-500">{invoice.customer.address}</p>
              <p dir="ltr" className="text-right text-slate-500">{invoice.customer.phone}</p>
            </div>
          </section>

          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1 text-right font-medium">المنتج</th>
                <th className="py-1 text-center font-medium">الكمية</th>
                <th className="py-1 text-center font-medium">سعر الوحدة</th>
                <th className="py-1 text-left font-medium">المجموع</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 text-slate-800">
                    {item.name} <span className="text-slate-400">({item.unit})</span>
                  </td>
                  <td className="py-1.5 text-center">{item.quantity}</td>
                  <td className="py-1.5 text-center">{formatDzd(item.unitPrice)}</td>
                  <td className="py-1.5 text-left">{formatDzd(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="space-y-1">
            <div className="flex justify-between text-slate-600">
              <dt>مجموع المنتجات</dt>
              <dd>{formatDzd(invoice.productsTotal)}</dd>
            </div>
            <div className="flex justify-between text-slate-600">
              <dt>رسوم التوصيل</dt>
              <dd>{formatDzd(invoice.deliveryFee)}</dd>
            </div>
            {invoice.discount > 0 && (
              <div className="flex justify-between text-emerald-700">
                <dt>الخصم</dt>
                <dd>− {formatDzd(invoice.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <dt>الإجمالي النهائي</dt>
              <dd>{formatDzd(invoice.total)}</dd>
            </div>
          </dl>

          <p className="rounded-xl bg-brand-50 p-3 text-xs text-brand-800">
            طريقة الدفع: {invoice.paymentLabel}. {invoice.paymentNote}
          </p>
        </article>

        <Button className="w-full print:hidden" variant="secondary" onClick={() => window.print()}>
          🖨️ طباعة / حفظ PDF
        </Button>
      </div>
    </div>
  );
}
