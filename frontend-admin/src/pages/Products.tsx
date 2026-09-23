import { useCallback, useEffect, useState } from 'react';
import { Chip, DataTable, Pager, type Column } from '../components/DataTable';
import { PageTitle } from '../components/Layout';
import { ProductImage } from '../components/ProductImage';
import { Alert, EmptyState, LoadingBlock, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { ACCEPT_ATTR, prepareImage } from '../lib/imageUpload';
import type { AdminProduct } from '../lib/types';

type ImageFilter = 'all' | 'with' | 'without';

/**
 * كتالوج المنتجات العالمي: الصورة مرتبطة بالمنتج نفسه وتظهر عند كل المحلات التي تعرضه.
 * تغيير الصورة أو حذفها من صلاحية الإدارة (ويُسجَّل في سجل العمليات)، ولا يمس أسعار المحلات أو الطلبات.
 */
export default function Products() {
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [image, setImage] = useState<ImageFilter>('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .products({ q: search || undefined, image, page, limit: 20 })
      .then((r) => {
        setRows(r.items);
        setMeta({ page: r.meta.page, totalPages: r.meta.totalPages, total: r.meta.total });
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [search, image, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function upload(product: AdminProduct, file: File | undefined) {
    if (!file) return;
    if (product.imageUrl && !confirm(`استبدال صورة «${product.name}»؟ ستتغير عند كل المحلات والزبائن.`)) return;
    setError(null);
    setNotice(null);
    setBusy(product.id);
    try {
      const blob = await prepareImage(file);
      await api.setProductImage(product.id, blob);
      setNotice(`تم تحديث صورة «${product.name}».`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر رفع الصورة.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(product: AdminProduct) {
    if (!confirm(`حذف صورة «${product.name}»؟ المنتج نفسه وأسعار المحلات والطلبات تبقى كما هي.`)) return;
    setError(null);
    setNotice(null);
    setBusy(product.id);
    try {
      await api.removeProductImage(product.id);
      setNotice(`حُذفت صورة «${product.name}».`);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر حذف الصورة.');
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<AdminProduct>[] = [
    {
      key: 'product',
      header: 'المنتج',
      render: (p) => (
        <div className="flex items-center gap-3">
          <ProductImage src={p.imageUrl} className="size-14" />
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{p.name}</p>
            <p className="text-xs text-slate-500">
              {[p.brand, p.unit].filter(Boolean).join(' · ')}
            </p>
            {p.barcode && (
              <p className="text-[11px] text-slate-400" dir="ltr">
                {p.barcode}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'info',
      header: 'معلومات',
      hideOnMobile: true,
      render: (p) => (
        <div className="space-y-1 text-xs text-slate-600">
          <Chip tone={p.imageUrl ? 'ok' : 'warn'}>{p.imageUrl ? 'له صورة' : 'بلا صورة'}</Chip>
          <p>{p.shopsCount ?? 0} محل يعرضه</p>
          {p.category && <p>{p.category.name}</p>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'الصورة',
      render: (p) => (
        <div className="flex flex-wrap gap-1.5">
          <label
            className={`cursor-pointer rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-medium text-brand-700 ${
              busy === p.id ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            {busy === p.id ? 'جارٍ…' : p.imageUrl ? 'تغيير' : 'رفع صورة'}
            <input
              type="file"
              accept={ACCEPT_ATTR}
              className="sr-only"
              onChange={(e) => {
                void upload(p, e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {p.imageUrl && (
            <button
              type="button"
              disabled={busy === p.id}
              onClick={() => remove(p)}
              className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
            >
              حذف
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageTitle title="المنتجات" subtitle={`${meta.total} منتج في كتالوج المنصة — صورة واحدة لكل منتج تظهر عند كل المحلات`} />

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث بالاسم أو العلامة أو الباركود…"
          className={`${inputClass} max-w-xs`}
        />
        <select
          className={`${inputClass} max-w-44`}
          value={image}
          onChange={(e) => {
            setImage(e.target.value as ImageFilter);
            setPage(1);
          }}
        >
          <option value="all">كل المنتجات</option>
          <option value="without">بلا صورة</option>
          <option value="with">لها صورة</option>
        </select>
      </div>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {notice && <div className="mb-3"><Alert kind="success">{notice}</Alert></div>}

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState icon="📦" title="لا توجد منتجات" />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <Pager page={meta.page} totalPages={meta.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
