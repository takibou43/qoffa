import { Link } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { formatDzd } from '../lib/format';
import { CartIcon, ChevronIcon } from './icons';

/** ارتفاع شريط التنقل السفلي (h-16) + المساحة الآمنة — الشريط يجلس فوقه مباشرة */
export const CART_BAR_OFFSET = 'calc(4rem + env(safe-area-inset-bottom) + 1rem)';

/**
 * شريط سلة ثابت أسفل الشاشة: 🛒 3 منتجات — 1,850 دج · عرض السلة ←
 * يتحدث فورًا من سياق السلة. الصفحة التي تعرضه تضيف مساحة سفلية (pb-28) حتى لا يغطي المحتوى.
 */
export function CartBar() {
  const { itemCount, subtotal } = useCart();
  if (itemCount === 0) return null;

  return (
    <div
      className="fixed inset-x-0 z-20 mx-auto w-full max-w-2xl px-3"
      style={{ bottom: CART_BAR_OFFSET }}
    >
      <Link
        to="/cart"
        className="flex min-h-14 items-center gap-3 rounded-2xl bg-brand-700 px-4 py-2.5 text-white shadow-lg shadow-brand-900/25 transition active:scale-[0.99]"
        aria-label={`عرض السلة: ${itemCount} منتج بمبلغ ${formatDzd(subtotal)}`}
      >
        <span className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-white/15">
          <CartIcon className="size-5" />
          <span className="absolute -top-1.5 -left-1.5 min-w-[18px] rounded-full bg-white px-1 text-center text-[10px] font-bold leading-[18px] text-brand-800">
            {itemCount > 99 ? '99+' : itemCount}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs opacity-90">
            {itemCount} {itemCount === 1 ? 'منتج' : itemCount === 2 ? 'منتجان' : itemCount <= 10 ? 'منتجات' : 'منتجًا'}
          </span>
          <span className="block truncate text-base font-extrabold tabular-nums">{formatDzd(subtotal)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-bold">
          عرض السلة
          <ChevronIcon />
        </span>
      </Link>
    </div>
  );
}
