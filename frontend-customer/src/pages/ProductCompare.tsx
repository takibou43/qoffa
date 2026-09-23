import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ProductImage } from '../components/ProductImage';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDzd } from '../lib/format';
import type { CatalogEntry } from '../lib/types';

/**
 * نفس المنتج في كل محلات قُفّة: صورة واحدة للمنتج، وسعر كل محل مستقل (الأرخص أولًا).
 * البيانات من قاعدة قُفّة فقط — لا يُستدعى أي مصدر خارجي عند العرض.
 */
export default function ProductCompare() {
  const { barcode = '' } = useParams();
  const [data, setData] = useState<CatalogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    api
      .catalogByBarcode(barcode)
      .then((r) => alive && setData(r))
      .catch((e: ApiError) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [barcode]);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingBlock />;

  const { product, shops } = data;
  return (
    <div>
      <PageHeader title={product.name} subtitle="مقارنة الأسعار بين المحلات" />
      <div className="space-y-3 px-4 py-3">
        <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          <ProductImage src={product.imageUrl} className="size-24" />
          <div className="min-w-0 text-sm">
            <h2 className="font-bold text-slate-900">{product.name}</h2>
            {product.brand && <p className="text-xs text-slate-600">{product.brand}</p>}
            <p className="text-xs text-slate-600">{product.unit}</p>
            {product.barcode && (
              <p className="text-[11px] text-slate-400" dir="ltr">
                {product.barcode}
              </p>
            )}
          </div>
        </div>

        {shops.length === 0 ? (
          <EmptyState icon="🏪" title="لا يوجد محل يعرض هذا المنتج حاليًا" />
        ) : (
          <ul className="space-y-2">
            {shops.map((s) => (
              <li key={s.listingId}>
                <Link
                  to={`/shops/${s.shop.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{s.shop.name}</p>
                    <p className="text-xs text-slate-500">
                      {s.shop.city} · {s.shop.isOpen ? 'مفتوح' : 'مغلق'}
                      {!s.isAvailable && ' · غير متوفر'}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-brand-700">{formatDzd(s.price)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
