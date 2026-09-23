import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDzd } from '../lib/format';
import type { Product } from '../lib/types';
import { productTone } from '../lib/visuals';
import { CloseIcon } from './icons';
import { QtyStepper } from './ProductCard';
import { ProductImage } from './ProductImage';

/**
 * تفاصيل المنتج في نافذة سفلية (بدل صفحة جديدة): الصورة، الاسم، السعر، الوصف، الكمية، والإضافة للسلة.
 * لا طلبات API إضافية — نفس بيانات المنتج المحمّلة في الشبكة.
 */
export function ProductSheet({
  product,
  inCart,
  shopOpen,
  onClose,
  onConfirm,
}: {
  product: Product;
  /** الكمية الحالية في السلة (0 إن لم يكن فيها) */
  inCart: number;
  shopOpen: boolean;
  onClose: () => void;
  /** تثبيت الكمية النهائية لهذا المنتج في السلة */
  onConfirm: (product: Product, quantity: number) => void;
}) {
  const [quantity, setQuantity] = useState(inCart > 0 ? inCart : 1);

  // إغلاق بزر Escape + منع تمرير الصفحة خلف النافذة
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const unavailable = !product.isAvailable;
  const details = [product.brand, product.unit].filter(Boolean).join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={product.name}>
      <button type="button" aria-label="إغلاق" onClick={onClose} className="absolute inset-0 bg-slate-900/40" />

      <div className="pb-safe relative flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[2rem] bg-white shadow-2xl">
        <div className="relative shrink-0">
          <ProductImage
            src={product.imageUrl}
            fit="contain"
            eager
            icon="🛒"
            bgClass={productTone(product.id)}
            className="h-64 w-full rounded-none"
          />
          <span className="absolute top-2 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-slate-900/15" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="absolute top-3 left-3 grid size-10 place-items-center rounded-full bg-white/90 text-slate-700 shadow"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">
          <h2 className="break-words text-xl leading-snug font-bold text-slate-900">{product.name}</h2>
          {details && <p className="mt-1 text-sm text-slate-500">{details}</p>}
          <p className="mt-3 text-2xl font-extrabold text-brand-700 tabular-nums">{formatDzd(product.price)}</p>

          {product.description && (
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-slate-600">{product.description}</p>
          )}

          {product.barcode && (
            <Link
              to={`/products/${encodeURIComponent(product.barcode)}`}
              className="mt-3 inline-block text-sm font-semibold text-brand-700"
            >
              قارن سعره في المحلات الأخرى ←
            </Link>
          )}

          {!shopOpen && !unavailable && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              المحل مغلق الآن — يمكنك إضافة المنتج للسلة وإرسال الطلب عند فتحه.
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 px-5 pt-3 pb-3">
          {unavailable ? (
            <p className="rounded-2xl bg-slate-100 py-3.5 text-center text-sm font-semibold text-slate-500">
              غير متوفر حاليًا
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-[8.5rem] shrink-0">
                <QtyStepper
                  size="lg"
                  quantity={quantity}
                  name={product.name}
                  onDec={() => setQuantity((q) => Math.max(1, q - 1))}
                  onInc={() => setQuantity((q) => Math.min(99, q + 1))}
                />
              </div>
              <button
                type="button"
                onClick={() => onConfirm(product, quantity)}
                className="min-h-14 min-w-0 flex-1 rounded-2xl bg-brand-600 px-3 text-sm font-bold text-white shadow-md shadow-brand-600/30 active:bg-brand-700"
              >
                <span className="block text-sm leading-5">{inCart > 0 ? 'تحديث السلة' : 'أضف للسلة'}</span>
                <span className="block text-xs leading-4 font-semibold opacity-90 tabular-nums">
                  {formatDzd(product.price * quantity)}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
