import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * يعرض رمز QR للطلب + رقم الطلب بخط كبير.
 * الحمولة رمز عشوائي فقط (لا بيانات للطلب) ويتحقق منها الخادم عند مسحها.
 */
export function OrderQr({
  payload,
  code,
  title,
  hint,
  verifiedAt,
  verifiedLabel,
}: {
  payload: string;
  code: string;
  title: string;
  hint: string;
  verifiedAt?: string | null;
  verifiedLabel?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 560 })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [payload]);

  return (
    <section className="rounded-2xl border-2 border-brand-300 bg-white p-4 text-center">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
      <div className="mx-auto mt-3 w-full max-w-[280px] rounded-xl bg-white">
        {src ? (
          <img
            src={src}
            alt={`رمز QR للطلب ${code}`}
            className="aspect-square w-full"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : failed ? (
          <p className="py-8 text-sm text-red-600">تعذّر إنشاء رمز QR</p>
        ) : (
          <div className="aspect-square w-full animate-pulse rounded-lg bg-slate-100" />
        )}
      </div>
      <p className="mt-3 text-xs text-slate-500">رقم الطلب</p>
      <p dir="ltr" className="font-mono text-2xl font-bold tracking-widest text-slate-900">
        {code}
      </p>
      {verifiedAt && verifiedLabel && (
        <p className="mt-2 rounded-lg bg-emerald-50 py-1.5 text-xs font-bold text-emerald-700">
          ✓ {verifiedLabel}
        </p>
      )}
    </section>
  );
}
