import { useCallback, useEffect, useState } from 'react';
import { Chip, DataTable, Pager, type Column } from '../components/DataTable';
import { PageTitle } from '../components/Layout';
import { Alert, EmptyState, LoadingBlock, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDzd } from '../lib/format';
import type { AdminShop, ApprovalStatus } from '../lib/types';

const STATUS: Record<ApprovalStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  APPROVED: { label: 'معتمد', tone: 'ok' },
  PENDING: { label: 'قيد المراجعة', tone: 'warn' },
  REJECTED: { label: 'مرفوض', tone: 'bad' },
  SUSPENDED: { label: 'معلّق', tone: 'bad' },
};

export default function Shops() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';

  const [rows, setRows] = useState<AdminShop[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      .shops({ status: status || undefined, q: search || undefined, page, limit: 20 })
      .then((r) => {
        setRows(r.items);
        setMeta({ page: r.meta.page, totalPages: r.meta.totalPages, total: r.meta.total });
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function setShopStatus(shop: AdminShop, next: ApprovalStatus) {
    let reason: string | undefined;
    if (next === 'REJECTED' || next === 'SUSPENDED') {
      const input = prompt(`سبب ${next === 'REJECTED' ? 'الرفض' : 'التعليق'} (اختياري):`);
      if (input === null) return;
      reason = input.trim() || undefined;
    }
    setError(null);
    setBusy(shop.id);
    try {
      await api.setShopStatus(shop.id, next, reason);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تنفيذ العملية.');
    } finally {
      setBusy(null);
    }
  }

  async function changeCommission(shop: AdminShop) {
    const input = prompt(
      `عمولة المنصة على «${shop.name}» بالنسبة المئوية (الحالية ${(shop.commissionBps / 100).toFixed(1)}%):`,
      (shop.commissionBps / 100).toFixed(1),
    );
    if (input === null) return;
    const percent = Number(input);
    if (!Number.isFinite(percent) || percent < 0 || percent > 50) {
      setError('النسبة يجب أن تكون بين 0 و 50.');
      return;
    }
    setBusy(shop.id);
    try {
      await api.setShopCommission(shop.id, Math.round(percent * 100));
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تغيير العمولة.');
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<AdminShop>[] = [
    {
      key: 'shop',
      header: 'المحل',
      render: (s) => (
        <div>
          <p className="font-medium text-slate-900">{s.name}</p>
          <p className="text-xs text-slate-500">{s.city} · {s.owner.fullName}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (s) => (
        <div className="space-y-1">
          <Chip tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Chip>
          {s.status === 'APPROVED' && (
            <Chip tone={s.isOpen ? 'ok' : 'muted'}>{s.isOpen ? 'مفتوح' : 'مغلق'}</Chip>
          )}
        </div>
      ),
    },
    {
      key: 'numbers',
      header: 'أرقام',
      hideOnMobile: true,
      render: (s) => (
        <div className="text-xs text-slate-600">
          <p>{s._count.products} منتج · {s._count.orders} طلب</p>
          <p>توصيل {formatDzd(s.deliveryFee)} · عمولة {(s.commissionBps / 100).toFixed(1)}%</p>
          <p>⭐ {s.ratingCount === 0 ? '—' : `${s.ratingAvg.toFixed(1)} (${s.ratingCount})`}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (s) => (
        <div className="flex flex-wrap gap-1.5">
          {s.status !== 'APPROVED' && (
            <button
              type="button"
              disabled={busy === s.id}
              onClick={() => setShopStatus(s, 'APPROVED')}
              className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 disabled:opacity-50"
            >
              {s.status === 'PENDING' ? 'اعتماد' : 'إعادة تفعيل'}
            </button>
          )}
          {s.status === 'PENDING' && (
            <button
              type="button"
              disabled={busy === s.id}
              onClick={() => setShopStatus(s, 'REJECTED')}
              className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
            >
              رفض
            </button>
          )}
          {s.status === 'APPROVED' && (
            <button
              type="button"
              disabled={busy === s.id}
              onClick={() => setShopStatus(s, 'SUSPENDED')}
              className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
            >
              تعليق
            </button>
          )}
          {isSuper && (
            <button
              type="button"
              disabled={busy === s.id}
              onClick={() => changeCommission(s)}
              className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
            >
              العمولة
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageTitle title="المحلات" subtitle={`${meta.total} محل`} />

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث باسم المحل…"
          className={`${inputClass} max-w-xs`}
        />
        <select
          className={`${inputClass} max-w-44`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">كل الحالات</option>
          <option value="PENDING">قيد المراجعة</option>
          <option value="APPROVED">معتمد</option>
          <option value="REJECTED">مرفوض</option>
          <option value="SUSPENDED">معلّق</option>
        </select>
      </div>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState icon="🏪" title="لا توجد محلات" />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <Pager page={meta.page} totalPages={meta.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
