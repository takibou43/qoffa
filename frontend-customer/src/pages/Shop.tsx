import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { useCart } from '../lib/cart';
import { formatDistance, formatDzd } from '../lib/format';
import { useLocation as useGeo } from '../lib/location';
import type { Product, Shop } from '../lib/types';
import { ProductImage } from '../components/ProductImage';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  LoadingBlock,
  OpenBadge,
  Rating,
  SkeletonCard,
} from '../components/ui';

function ProductRow({
  product,
  shop,
  onReplaced,
}: {
  product: Product;
  shop: Shop;
  onReplaced: () => void;
}) {
  const cart = useCart();
  const line = cart.lines.find((l) => l.productId === product.id);
  const quantity = cart.shopId === shop.id ? (line?.quantity ?? 0) : 0;

  const add = () => {
    const { replaced } = cart.add({ id: shop.id, name: shop.name }, product);
    if (replaced) onReplaced();
  };

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
      <ProductImage src={product.imageUrl} className="size-16" />

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-slate-900">{product.name}</h3>
        <p className="text-xs text-slate-500">{product.unit}</p>
        <p className="mt-1 text-sm font-bold text-brand-700">{formatDzd(product.price)}</p>
      </div>

      {!product.isAvailable ? (
        <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-500">
          غير متوفر
        </span>
      ) : quantity === 0 ? (
        <button
          type="button"
          onClick={add}
          aria-label={`إضافة ${product.name} إلى السلة`}
          className="size-10 shrink-0 rounded-xl bg-brand-700 text-xl font-bold text-white active:scale-95"
        >
          +
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-brand-50 p-1">
          <button
            type="button"
            onClick={() => cart.setQuantity(product.id, quantity - 1)}
            aria-label="إنقاص الكمية"
            className="size-8 rounded-lg bg-white text-lg font-bold text-brand-700 active:scale-95"
          >
            −
          </button>
          <span className="w-6 text-center text-sm font-bold text-brand-800">{quantity}</span>
          <button
            type="button"
            onClick={() => cart.setQuantity(product.id, quantity + 1)}
            aria-label="زيادة الكمية"
            className="size-8 rounded-lg bg-white text-lg font-bold text-brand-700 active:scale-95"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

export default function ShopPage() {
  const { shopId = '' } = useParams();
  const { coords } = useGeo();
  const cart = useCart();

  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [loadingShop, setLoadingShop] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replacedNotice, setReplacedNotice] = useState(false);

  useEffect(() => {
    setLoadingShop(true);
    api
      .shop(shopId, coords?.lat, coords?.lon)
      .then((r) => setShop(r.shop))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoadingShop(false));
  }, [shopId, coords?.lat, coords?.lon]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setLoadingProducts(true);
    api
      .shopProducts(shopId, { q: search || undefined, categoryId, limit: 50 })
      .then((r) => setProducts(r.items))
      .catch(() => setProducts([]))
      .finally(() => setLoadingProducts(false));
  }, [shopId, search, categoryId]);

  const productCategories = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of products) if (p.category) map.set(p.category.id, p.category.name);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [products]);

  if (loadingShop) return <LoadingBlock />;
  if (error || !shop) return <ErrorState message={error ?? 'المحل غير متاح'} />;

  const distance = formatDistance(shop.distanceMeters);
  const cartHasThisShop = cart.shopId === shop.id && cart.itemCount > 0;

  return (
    <div className="pb-24">
      <div className="relative h-40 bg-brand-100">
        {shop.imageUrl ? (
          <img src={shop.imageUrl} alt="" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-6xl" aria-hidden>
            🏪
          </div>
        )}
        <Link
          to="/"
          aria-label="رجوع"
          className="absolute top-3 right-3 grid size-10 place-items-center rounded-full bg-white/90 text-lg shadow"
        >
          ←
        </Link>
      </div>

      <div className="border-b border-slate-200 bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-bold text-slate-900">{shop.name}</h1>
          <OpenBadge isOpenNow={shop.isOpenNow} />
        </div>
        {shop.description && <p className="mt-1 text-sm text-slate-600">{shop.description}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
          <Rating value={shop.ratingAvg} count={shop.ratingCount} />
          {distance && <span>📍 {distance}</span>}
          <span>🛵 التوصيل حسب المسافة (يظهر السعر عند إتمام الطلب)</span>
          <span>
            🕐 {shop.openingTime} — {shop.closingTime}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">{shop.addressLine}، {shop.city}</p>

        {!shop.isOpenNow && (
          <div className="mt-3">
            <Alert kind="info">
              المحل مغلق حاليًا. يمكنك تصفّح المنتجات، لكن لا يمكن إرسال الطلب حتى يفتح.
            </Alert>
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        {replacedNotice && (
          <div className="mb-3">
            <Alert kind="info">
              سلتك كانت تحتوي منتجات من محل آخر، فتم استبدالها. الطلب الواحد من محل واحد.
            </Alert>
          </div>
        )}

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث داخل منتجات المحل…"
          aria-label="ابحث داخل المنتجات"
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm outline-none focus:border-brand-600"
        />

        {productCategories.length > 1 && (
          <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
            <button
              type="button"
              onClick={() => setCategoryId(undefined)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${
                !categoryId ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
              }`}
            >
              كل المنتجات
            </button>
            {productCategories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${
                  categoryId === c.id
                    ? 'bg-brand-700 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 space-y-2.5">
          {loadingProducts ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : products.length === 0 ? (
            <EmptyState
              icon="🛒"
              title="لا توجد منتجات"
              description={search ? 'لم نجد منتجًا بهذا الاسم.' : 'لم يُضف هذا المحل منتجات بعد.'}
            />
          ) : (
            products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                shop={shop}
                onReplaced={() => setReplacedNotice(true)}
              />
            ))
          )}
        </div>
      </div>

      {cartHasThisShop && (
        <div className="pb-safe fixed inset-x-0 bottom-16 z-20 mx-auto w-full max-w-2xl px-4">
          <Link to="/cart" className="block">
            <Button className="w-full shadow-lg">
              عرض السلة · {cart.itemCount} منتج · {formatDzd(cart.subtotal)}
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
