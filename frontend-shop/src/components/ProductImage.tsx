import { useState } from 'react';

/**
 * صورة المنتج مع بديل واضح: لا صورة مكسورة أبدًا.
 * lazy + async decoding حتى لا تثقل القوائم الطويلة.
 */
export function ProductImage({
  src,
  className = '',
  icon = '📦',
}: {
  src: string | null | undefined;
  className?: string;
  icon?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const show = !!src && failedSrc !== src;
  return (
    <div className={`shrink-0 overflow-hidden rounded-xl bg-slate-100 ${className}`}>
      {show ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div className="grid size-full place-items-center text-xl text-slate-400" aria-label="لا توجد صورة">
          {icon}
        </div>
      )}
    </div>
  );
}
