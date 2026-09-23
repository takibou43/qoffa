import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CartBar } from '../components/CartBar';
import { BackIcon, ClockIcon, CloseIcon, PinIcon, ScooterIcon, SearchIcon } from '../components/icons';
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard';
import { ProductSheet } from '../components/ProductSheet';
import { Alert, EmptyState, ErrorState, LoadingBlock, OpenBadge, Rating } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useCart } from '../lib/cart';
import { formatDistance } from '../lib/format';
import { useLocation as useGeo } from '../lib/location';
import type { Product, Shop } from '../lib/types';
import { categoryEmoji } from '../lib/visuals';

const PAGE_SIZE = 50; // الحد الأقصى المسموح في الـAPI

/** تطبيع بسيط للبحث الفوري: بلا تشكيل، والهمزات والتاء المربوطة موحّدة */
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();

type Cat = { id: string; name: string; slug: string };

export default function ShopPage() {
  const { shopId = '' } = useParams();
  const { coords } = useGeo();
  const cart = useCart();

  const [shop, setShop] = useState<Shop | null>(null);
  const [loadingShop, setLoadingShop] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  /** تصنيفات منتجات هذا المحل — تُجمع من النتائج غير المصفّاة فتبقى ثابتة عند اختيار تصنيف */
  const [cats, setCats] = useState<Cat[]>([]);

  const [replacedNotice, setReplacedNotice] = useState(false);
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    setLoadingShop(true);
    api
      .shop(shopId, coords?.lat, coords?.lon)
      .then((r) => setShop(r.shop))
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoadingShop(false));
  }, [shopId, coords?.lat, coords?.lon]);

  // بحث الخادم بعد توقف الكتابة؛ وأثناء الكتابة نصفّي المحمّل محليًا فورًا
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // الصفحة الأولى عند تغيّر المحل/البحث/التصنيف
  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoadingProducts(true);
    api
      .shopProducts(shopId, { q: search || undefined, categoryId, limit: PAGE_SIZE, page: 1 })
      .then((r) => {
        if (seq !== requestSeq.current) return; // نتيجة قديمة
        setProducts(r.items);
        setPage(1);
        setHasNext(r.meta.hasNext);
        if (!search && !categoryId) {
          setCats((prev) => mergeCats(prev, r.items));
        }
      })
      .catch(() => {
        if (seq === requestSeq.current) {
          setProducts([]);
          setHasNext(false);
        }
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoadingProducts(false);
      });
  }, [shopId, search, categoryId]);

  const loadMore = () => {
    const seq = requestSeq.current;
    setLoadingMore(true);
    api
      .shopProducts(shopId, { q: search || undefined, categoryId, limit: PAGE_SIZE, page: page + 1 })
      .then((r) => {
        if (seq !== requestSeq.current) return;
        setProducts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...r.items.filter((p) => !seen.has(p.id))];
        });
        setPage((p) => p + 1);
        setHasNext(r.meta.hasNext);
        if (!search && !categoryId) setCats((prev) => mergeCats(prev, r.items));
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  };

  const typing = query.trim() !== search;
  const visible = useMemo(() => {
    if (!typing || !query.trim()) return products;
    const q = normalize(query);
    return products.filter((p) => normalize(`${p.name} ${p.brand ?? ''}`).includes(q) || p.barcode === query.trim());
  }, [products, query, typing]);

  const quantities = useMemo(() => {
    const map = new Map<string, number>();
    if (cart.shopId === shopId) for (const l of cart.lines) map.set(l.productId, l.quantity);
    return map;
  }, [cart.lines, cart.shopId, shopId]);

  const { add, setQuantity } = cart;
  const handleAdd = useCallback(
    (product: Product, qty = 1) => {
      if (!shop) return;
      const { replaced } = add({ id: shop.id, name: shop.name }, product, qty);
      if (replaced) setReplacedNotice(true);
    },
    [add, shop],
  );
  const handleOpen = useCallback((p: Product) => setOpenProduct(p), []);
  const closeSheet = useCallback(() => setOpenProduct(null), []);

  if (loadingShop) return <LoadingBlock />;
  if (error || !shop) return <ErrorState message={error ?? 'المحل غير متاح'} />;

  const distance = formatDistance(shop.distanceMeters);
  const filtered = !!search || !!categoryId || !!query.trim();

  return (
    <div className="pb-28">
      {/* رأس المحل — مضغوط حتى تظهر المنتجات بسرعة */}
      <div className="bg-white">
        <div className="relative h-32 bg-brand-100">
          {shop.imageUrl ? (
            <img src={shop.imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="grid size-full place-items-center bg-gradient-to-l from-brand-600 to-brand-500 text-5xl" aria-hidden>
              🏪
            </div>
          )}
          <Link
            to="/"
            aria-label="رجوع"
            className="absolute top-3 right-3 grid size-10 place-items-center rounded-full bg-white/95 text-slate-800 shadow"
          >
            <BackIcon />
          </Link>
        </div>

        <div className="px-4 pt-3 pb-3">
          <div className="flex items-start justify-between gap-3">
            <h1 className="min-w-0 break-words text-lg leading-snug font-bold text-slate-900">{shop.name}</h1>
            <OpenBadge isOpenNow={shop.isOpenNow} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <Rating value={shop.ratingAvg} count={shop.ratingCount} />
            {distance && (
              <span className="inline-flex items-center gap-1">
                <PinIcon className="size-3.5" /> {distance}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <ClockIcon className="size-3.5" /> {shop.openingTime} — {shop.closingTime}
            </span>
            <span className="inline-flex items-center gap-1">
              <ScooterIcon className="size-3.5" /> التوصيل حسب المسافة
            </span>
          </div>
          {!shop.isOpenNow && (
            <div className="mt-3">
              <Alert kind="info">المحل مغلق حاليًا. يمكنك التصفّح، لكن لا يمكن إرسال الطلب حتى يفتح.</Alert>
            </div>
          )}
        </div>
      </div>

      {/* البحث والتصنيفات — ثابتة أعلى الشاشة أثناء التمرير */}
      <div className="sticky top-0 z-20 border-b border-slate-100 bg-slate-50/95 pt-3 pb-2 backdrop-blur">
        <div className="px-4">
          <label className="relative block">
            <span className="pointer-events-none absolute inset-y-0 right-3.5 grid place-items-center text-slate-400">
              <SearchIcon />
            </span>
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ماذا تريد أن تشتري؟"
              aria-label="ابحث في منتجات المحل"
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white pr-11 pl-11 text-[15px] shadow-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="مسح البحث"
                className="absolute inset-y-0 left-1.5 my-auto grid size-9 place-items-center rounded-full text-slate-400 active:bg-slate-100"
              >
                <CloseIcon className="size-4" />
              </button>
            )}
          </label>
        </div>

        {cats.length > 0 && (
          <div className="no-scrollbar mt-2.5 flex gap-2 overflow-x-auto scroll-px-4 px-4 pb-1" role="tablist" aria-label="التصنيفات">
            <CatChip active={!categoryId} onClick={() => setCategoryId(undefined)} label="الكل" emoji="🧺" />
            {cats.map((c) => (
              <CatChip
                key={c.id}
                active={categoryId === c.id}
                onClick={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                label={c.name}
                emoji={categoryEmoji(c)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-3 pt-3">
        {replacedNotice && (
          <div className="mb-3">
            <Alert kind="info">سلتك كانت تحتوي منتجات من محل آخر، فتم استبدالها. الطلب الواحد من محل واحد.</Alert>
          </div>
        )}

        {loadingProducts && visible.length === 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={filtered ? 'لا توجد نتائج' : 'لا توجد منتجات'}
            description={filtered ? 'جرّب كلمة أخرى أو تصنيفًا آخر.' : 'لم يُضف هذا المحل منتجات متوفرة بعد.'}
          />
        ) : (
          <>
            <div
              className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 ${loadingProducts ? 'opacity-60' : ''}`}
              data-testid="product-grid"
            >
              {visible.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  quantity={quantities.get(product.id) ?? 0}
                  onAdd={handleAdd}
                  onSetQuantity={setQuantity}
                  onOpen={handleOpen}
                />
              ))}
            </div>
            {hasNext && !typing && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="mt-4 min-h-12 w-full rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-brand-700 active:bg-slate-50 disabled:opacity-60"
              >
                {loadingMore ? 'جاري التحميل…' : 'عرض المزيد من المنتجات'}
              </button>
            )}
          </>
        )}
      </div>

      <CartBar />

      {openProduct && (
        <ProductSheet
          key={openProduct.id}
          product={openProduct}
          inCart={quantities.get(openProduct.id) ?? 0}
          shopOpen={shop.isOpenNow}
          onClose={closeSheet}
          onConfirm={(product, qty) => {
            if ((quantities.get(product.id) ?? 0) > 0) setQuantity(product.id, qty);
            else handleAdd(product, qty);
            setOpenProduct(null);
          }}
        />
      )}
    </div>
  );
}

function mergeCats(prev: Cat[], items: Product[]): Cat[] {
  const map = new Map(prev.map((c) => [c.id, c]));
  for (const p of items) if (p.category && !map.has(p.category.id)) map.set(p.category.id, p.category);
  return map.size === prev.length ? prev : [...map.values()];
}

function CatChip({
  active,
  onClick,
  label,
  emoji,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  emoji: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition ${
        active
          ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
          : 'bg-white text-slate-600 ring-1 ring-slate-200 active:bg-slate-100'
      }`}
    >
      <span aria-hidden className="text-base leading-none">
        {emoji}
      </span>
      {label}
    </button>
  );
}
