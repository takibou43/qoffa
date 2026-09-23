import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Alert, Button, EmptyState } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/cart';
import { formatDzd } from '../lib/format';
import { ProductImage } from '../components/ProductImage';

export default function Cart() {
  const cart = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  if (cart.lines.length === 0) {
    return (
      <>
        <PageHeader title="السلة" />
        <EmptyState
          icon="🧺"
          title="سلتك فارغة"
          description="تصفّح المحلات القريبة وأضف ما تحتاجه."
          action={
            <Link to="/">
              <Button>تصفّح المحلات</Button>
            </Link>
          }
        />
      </>
    );
  }

  return (
    <div className="pb-40">
      <PageHeader title="السلة" subtitle={cart.shopName ?? undefined} />

      <div className="space-y-2.5 px-4 py-3">
        <Alert kind="info">الطلب الواحد من محل واحد. المبالغ النهائية يحسبها الخادم عند التأكيد.</Alert>

        {cart.lines.map((line) => (
          <div
            key={line.productId}
            className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3"
          >
            <ProductImage src={line.imageUrl} className="size-14" />

            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold text-slate-900">{line.name}</h3>
              <p className="text-xs text-slate-500">
                {formatDzd(line.price)} / {line.unit}
              </p>
              <p className="mt-0.5 text-sm font-bold text-brand-700">
                {formatDzd(line.price * line.quantity)}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-center gap-1">
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => cart.setQuantity(line.productId, line.quantity - 1)}
                  aria-label="إنقاص الكمية"
                  className="size-8 rounded-lg bg-white text-lg font-bold text-slate-700 active:scale-95"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-bold">{line.quantity}</span>
                <button
                  type="button"
                  onClick={() => cart.setQuantity(line.productId, line.quantity + 1)}
                  aria-label="زيادة الكمية"
                  className="size-8 rounded-lg bg-white text-lg font-bold text-slate-700 active:scale-95"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                onClick={() => cart.remove(line.productId)}
                className="text-[11px] text-red-600"
              >
                حذف
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={cart.clear}
          className="w-full rounded-xl py-2 text-sm text-slate-500"
        >
          إفراغ السلة
        </button>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] z-20 pb-3 mx-auto w-full max-w-2xl border-t border-slate-200 bg-white px-4 pt-3">
        <dl className="mb-3 space-y-1 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>المنتجات</dt>
            <dd>{formatDzd(cart.subtotal)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>التوصيل</dt>
            <dd className="text-xs">يُحسب حسب المسافة عند التأكيد</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-bold text-slate-900">
            <dt>المجموع قبل التوصيل</dt>
            <dd>{formatDzd(cart.subtotal)}</dd>
          </div>
        </dl>

        <Button className="w-full" onClick={() => navigate(user ? '/checkout' : '/login')}>
          {user ? 'متابعة إلى تأكيد الطلب' : 'سجّل الدخول لإتمام الطلب'}
        </Button>
      </div>
    </div>
  );
}
