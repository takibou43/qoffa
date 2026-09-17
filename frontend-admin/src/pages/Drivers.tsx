import { useCallback, useEffect, useState } from 'react';
import { Chip, DataTable, Pager, type Column } from '../components/DataTable';
import { PageTitle } from '../components/Layout';
import { Alert, EmptyState, LoadingBlock, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import type { AdminDriver, ApprovalStatus } from '../lib/types';

const STATUS: Record<ApprovalStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }> = {
  APPROVED: { label: 'معتمد', tone: 'ok' },
  PENDING: { label: 'قيد المراجعة', tone: 'warn' },
  REJECTED: { label: 'مرفوض', tone: 'bad' },
  SUSPENDED: { label: 'معلّق', tone: 'bad' },
};

export default function Drivers() {
  const [rows, setRows] = useState<AdminDriver[]>([]);
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
      .drivers({ status: status || undefined, q: search || undefined, page, limit: 20 })
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

  async function change(driver: AdminDriver, next: ApprovalStatus) {
    let reason: string | undefined;
    if (next === 'REJECTED' || next === 'SUSPENDED') {
      const input = prompt(`سبب ${next === 'REJECTED' ? 'الرفض' : 'التعليق'} (اختياري):`);
      if (input === null) return;
      reason = input.trim() || undefined;
    }
    setError(null);
    setBusy(driver.id);
    try {
      await api.setDriverStatus(driver.id, next, reason);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر تنفيذ العملية.');
    } finally {
      setBusy(null);
    }
  }

  const columns: Column<AdminDriver>[] = [
    {
      key: 'driver',
      header: 'الموصّل',
      render: (d) => (
        <div>
          <p className="font-medium text-slate-900">{d.user.fullName}</p>
          <p className="text-xs text-slate-500" dir="ltr">{d.user.phone}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (d) => (
        <div className="space-y-1">
          <Chip tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Chip>
          {d.status === 'APPROVED' && (
            <Chip tone={d.isAvailable ? 'ok' : 'muted'}>{d.isAvailable ? 'متاح' : 'غير متاح'}</Chip>
          )}
          {d.currentOrderId && <Chip tone="warn">لديه طلب جارٍ</Chip>}
        </div>
      ),
    },
    {
      key: 'info',
      header: 'المعلومات',
      hideOnMobile: true,
      render: (d) => (
        <div className="text-xs text-slate-600">
          <p>{d.vehicleType}{d.plateNumber ? ` · ${d.plateNumber}` : ''}</p>
          <p>{d._count.orders} توصيلة</p>
          <p>⭐ {d.ratingCount === 0 ? '—' : `${d.ratingAvg.toFixed(1)} (${d.ratingCount})`}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (d) => (
        <div className="flex flex-wrap gap-1.5">
          {d.status !== 'APPROVED' && (
            <button
              type="button"
              disabled={busy === d.id}
              onClick={() => change(d, 'APPROVED')}
              className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 disabled:opacity-50"
            >
              {d.status === 'PENDING' ? 'اعتماد' : 'إعادة تفعيل'}
            </button>
          )}
          {d.status === 'PENDING' && (
            <button
              type="button"
              disabled={busy === d.id}
              onClick={() => change(d, 'REJECTED')}
              className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
            >
              رفض
            </button>
          )}
          {d.status === 'APPROVED' && (
            <button
              type="button"
              disabled={busy === d.id}
              onClick={() => change(d, 'SUSPENDED')}
              className="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
            >
              تعليق
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageTitle title="الموصّلون" subtitle={`${meta.total} موصّل`} />

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث بالاسم أو الهاتف…"
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
        <EmptyState icon="🛵" title="لا يوجد موصّلون" />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <Pager page={meta.page} totalPages={meta.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
