import { memo } from 'react';
import { formatDzd } from '../lib/format';
import type { Product } from '../lib/types';
import { productTone } from '../lib/visuals';
import { MinusIcon, PlusIcon } from './icons';
import { ProductImage } from './ProductImage';

/** عدّاد الكمية: − 2 + — أزرار كبيرة مناسبة للإصبع (40px) */
export function QtyStepper({
  quantity,
  onDec,
  onInc,
  name,
  size = 'md',
}: {
  quantity: number;
  onDec: () => void;
  onInc: () => void;
  name: string;
  size?: 'md' | 'lg';
}) {
  const btn = size === 'lg' ? 'size-12' : 'size-10';
  return (
    <div className="flex items-center justify-between gap-1 rounded-2xl bg-brand-600 p-1 text-white shadow-sm">
      <button
        type="button"
        onClick={onDec}
        aria-label={`إنقاص كمية ${name}`}
        className={`${btn} grid shrink-0 place-items-center rounded-xl active:bg-brand-700`}
      >
        <MinusIcon />
      </button>
      <span className="min-w-6 text-center text-base font-bold tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        onClick={onInc}
        disabled={quantity >= 99}
        aria-label={`زيادة كمية ${name}`}
        className={`${btn} grid shrink-0 place-items-center rounded-xl active:bg-brand-700 disabled:opacity-50`}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

/**
 * بطاقة منتج للشبكة (عمودان على الهاتف): صورة موحّدة الحجم، اسم بسطرين كحد أقصى، الوحدة، سعر بارز،
 * وزر + يتحوّل إلى عدّاد بعد الإضافة. الضغط على الصورة/الاسم يفتح التفاصيل.
 */
export const ProductCard = memo(function ProductCard({
  product,
  quantity,
  onAdd,
  onSetQuantity,
  onOpen,
}: {
  product: Product;
  quantity: number;
  onAdd: (product: Product) => void;
  onSetQuantity: (productId: string, quantity: number) => void;
  onOpen: (product: Product) => void;
}) {
  const unavailable = !product.isAvailable;

  return (
    <article
      className={`flex min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white p-2 shadow-[0_2px_10px_rgba(15,23,42,0.04)] ${
        unavailable ? 'opacity-60' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(product)}
        className="block w-full text-right"
        aria-label={`تفاصيل ${product.name}`}
      >
        <div className="relative">
          <ProductImage
            src={product.imageUrl}
            fit="contain"
            bgClass={productTone(product.id)}
            className="aspect-square w-full rounded-2xl"
          />
          {unavailable && (
            <span className="absolute inset-x-2 bottom-2 rounded-lg bg-slate-900/75 py-1 text-center text-[11px] font-semibold text-white">
              غير متوفر حاليًا
            </span>
          )}
        </div>
        <div className="px-1 pt-2">
          <h3 className="line-clamp-2 min-h-[2.5rem] break-words text-sm leading-5 font-semibold text-slate-900">
            {product.name}
          </h3>
          <p className="mt-0.5 h-4 truncate text-xs leading-4 text-slate-400">{product.unit}</p>
        </div>
      </button>

      <div className="mt-auto px-1 pt-2">
        {quantity > 0 && !unavailable ? (
          <div className="space-y-1.5">
            <p className="truncate text-base font-extrabold text-slate-900 tabular-nums">{formatDzd(product.price)}</p>
            <QtyStepper
              quantity={quantity}
              name={product.name}
              onDec={() => onSetQuantity(product.id, quantity - 1)}
              onInc={() => onSetQuantity(product.id, quantity + 1)}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-base font-extrabold text-slate-900 tabular-nums">
              {formatDzd(product.price)}
            </p>
            {!unavailable && (
              <button
                type="button"
                onClick={() => onAdd(product)}
                aria-label={`إضافة ${product.name} إلى السلة`}
                className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-white shadow-sm shadow-brand-600/30 transition active:scale-95 active:bg-brand-700"
              >
                <PlusIcon className="size-6" />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
});

export function ProductCardSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl border border-slate-100 bg-white p-2">
      <div className="aspect-square w-full rounded-2xl bg-slate-100" />
      <div className="space-y-2 px-1 pt-3 pb-1">
        <div className="h-3.5 w-4/5 rounded bg-slate-200" />
        <div className="h-3 w-1/3 rounded bg-slate-100" />
        <div className="flex items-center justify-between pt-2">
          <div className="h-4 w-1/3 rounded bg-slate-200" />
          <div className="size-11 rounded-2xl bg-slate-100" />
        </div>
      </div>
    </div>
  );
}
