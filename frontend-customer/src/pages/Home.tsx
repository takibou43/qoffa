import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../lib/api';
import { formatDistance } from '../lib/format';
import { useLocation as useGeo } from '../lib/location';
import type { Category, Shop } from '../lib/types';
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  OpenBadge,
  Rating,
  SkeletonCard,
} from '../components/ui';

function ShopCard({ shop }: { shop: Shop }) {
  const distance = formatDistance(shop.distanceMeters);
  return (
    <Link
      to={`/shops/${shop.id}`}
      className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition active:scale-[0.99]"
    >
      <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-brand-50">
        {shop.imageUrl ? (
          <img
            src={shop.imageUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-3xl" aria-hidden>
            🏪
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold text-slate-900">{shop.name}</h3>
          <OpenBadge isOpenNow={shop.isOpenNow} />
        </div>
        {shop.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{shop.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <Rating value={shop.ratingAvg} count={shop.ratingCount} />
          {distance && <span>📍 {distance}</span>}
          <span>🛵 التوصيل حسب المسافة</span>
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  const { coords, status, request } = useGeo();
  const [shops, setShops] = useState<Shop[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .categories('SHOP')
      .then((r) => setCategories(r.items))
      .catch(() => setCategories([]));
  }, []);

  // تأخير بسيط للبحث حتى لا نُرسل طلبًا لكل حرف
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .shops({
        lat: coords?.lat,
        lon: coords?.lon,
        q: search || undefined,
        categoryId,
        openOnly: openOnly || undefined,
        limit: 20,
      })
      .then((r) => {
        if (!cancelled) setShops(r.items);
      })
      .catch((e: ApiError) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [coords?.lat, coords?.lon, search, categoryId, openOnly, reloadKey]);

  const locationHint = useMemo(() => {
    if (coords) return 'المحلات مرتّبة حسب قربها منك';
    if (status === 'denied') return 'بدون موقع — يمكنك البحث وإدخال عنوانك عند الطلب';
    return 'فعّل الموقع لعرض أقرب المحلات إليك';
  }, [coords, status]);

  return (
    <div>
      <header className="bg-brand-700 px-4 pt-5 pb-4 text-white">
        <p className="text-xs opacity-90">قُفّة</p>
        <h1 className="text-xl font-bold">من حانوتك إلى بابك</h1>

        <div className="mt-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن محل…"
            aria-label="ابحث عن محل"
            className="min-h-11 w-full rounded-xl border-0 bg-white px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>

        <p className="mt-2 text-[11px] opacity-90">{locationHint}</p>
      </header>

      <div className="px-4 py-3">
        {!coords && (
          <div className="mb-3">
            <Alert kind="info">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {status === 'denied'
                    ? 'لم نحصل على إذن الموقع. يمكنك المتابعة وإدخال عنوانك يدويًا عند إتمام الطلب.'
                    : 'شارك موقعك لعرض المحلات الأقرب إليك وحساب المسافة.'}
                </span>
                <Button variant="secondary" onClick={request} loading={status === 'loading'}>
                  تحديد موقعي
                </Button>
              </div>
            </Alert>
          </div>
        )}

        {/* التصنيفات */}
        {categories.length > 0 && (
          <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
            <button
              type="button"
              onClick={() => setCategoryId(undefined)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium ${
                !categoryId ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
              }`}
            >
              الكل
            </button>
            {categories.map((c) => (
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

        <label className="mb-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
            className="size-4 accent-brand-700"
          />
          المحلات المفتوحة فقط
        </label>

        {loading ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : shops.length === 0 ? (
          <EmptyState
            icon="🏪"
            title="لا توجد محلات"
            description={
              search || categoryId || openOnly
                ? 'جرّب تغيير البحث أو إزالة عوامل التصفية.'
                : 'لم تُضف محلات في منطقتك بعد.'
            }
          />
        ) : (
          <div className="space-y-3">
            {shops.map((shop) => (
              <ShopCard key={shop.id} shop={shop} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
