import { useState } from 'react';

/**
 * صورة المنتج مع بديل واضح: لا صورة مكسورة أبدًا.
 * lazy + async decoding حتى لا تثقل القوائم الطويلة.
 * fit="contain" مناسبة لبطاقات الشبكة: الصورة كاملة داخل إطار موحّد الحجم.
 */
export function ProductImage({
  src,
  className = '',
  icon = '🛒',
  fit = 'cover',
  bgClass = 'bg-slate-100',
  eager = false,
}: {
  src: string | null | undefined;
  className?: string;
  icon?: string;
  fit?: 'cover' | 'contain';
  bgClass?: string;
  eager?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const show = !!src && failedSrc !== src;
  return (
    <div className={`shrink-0 overflow-hidden rounded-xl ${bgClass} ${className}`}>
      {show ? (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={`size-full ${fit === 'contain' ? 'object-contain p-2 mix-blend-multiply' : 'object-cover'}`}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <div
          className={`grid size-full place-items-center text-slate-400 ${fit === 'contain' ? 'text-4xl' : 'text-xl'}`}
          aria-label="لا توجد صورة"
        >
          {icon}
        </div>
      )}
    </div>
  );
}
