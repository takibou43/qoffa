import { useCallback, useEffect, useState } from 'react';
import { Chip, DataTable, Pager, type Column } from '../components/DataTable';
import { PageTitle } from '../components/Layout';
import { Alert, EmptyState, LoadingBlock, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { AuditLog } from '../lib/types';

const ACTION_LABEL: Record<string, string> = {
  USER_SUSPENDED: 'تعليق مستخدم',
  USER_REACTIVATED: 'إعادة تفعيل مستخدم',
  USER_ROLE_CHANGED: 'تغيير دور',
  ADMIN_CREATED: 'إنشاء مدير',
  ADMIN_REMOVED: 'إزالة مدير',
  SHOP_APPROVED: 'اعتماد محل',
  SHOP_REJECTED: 'رفض محل',
  SHOP_SUSPENDED: 'تعليق محل',
  SHOP_REACTIVATED: 'إعادة تفعيل محل',
  SHOP_COMMISSION_CHANGED: 'تغيير عمولة محل',
  DRIVER_APPROVED: 'اعتماد موصّل',
  DRIVER_REJECTED: 'رفض موصّل',
  DRIVER_SUSPENDED: 'تعليق موصّل',
  DRIVER_REACTIVATED: 'إعادة تفعيل موصّل',
  ORDER_FORCE_STATUS: 'تغيير حالة طلب إداريًا',
  ORDER_REASSIGN_DRIVER: 'إعادة تعيين موصّل',
  WALLET_ADJUSTED: 'تعديل محفظة',
  WALLET_PAYOUT: 'صرف مستحقات',
  SETTING_CHANGED: 'تغيير إعداد',
  CATEGORY_CREATED: 'إنشاء تصنيف',
  CATEGORY_UPDATED: 'تعديل تصنيف',
  CATEGORY_DELETED: 'حذف تصنيف',
  PRODUCT_UPDATED: 'تعديل منتج',
  PRODUCT_DELETED: 'حذف منتج',
};

const TARGET_LABEL: Record<string, string> = {
  user: 'مستخدم',
  shop: 'محل',
  driver: 'موصّل',
  order: 'طلب',
  wallet: 'محفظة',
  setting: 'إعداد',
};

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [targetType, setTargetType] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .auditLog({ targetType: targetType || undefined, page, limit: 20 })
      .then((r) => {
        setRows(r.items);
        setMeta({ page: r.meta.page, totalPages: r.meta.totalPages, total: r.meta.total });
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [targetType, page]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<AuditLog>[] = [
    {
      key: 'when',
      header: 'الوقت',
      render: (l) => <span className="text-xs text-slate-600">{formatDateTime(l.createdAt)}</span>,
    },
    {
      key: 'actor',
      header: 'المنفّذ',
      render: (l) => (
        <div>
          <p className="text-sm font-medium text-slate-900">{l.actor.fullName}</p>
          <p className="text-xs text-slate-500">
            {l.actor.role === 'SUPER_ADMIN' ? 'مالك المنصة' : 'مدير'}
          </p>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'العملية',
      render: (l) => <Chip tone="muted">{ACTION_LABEL[l.action] ?? l.action}</Chip>,
    },
    {
      key: 'target',
      header: 'الهدف',
      hideOnMobile: true,
      render: (l) => (
        <div className="text-xs text-slate-600">
          <p>{TARGET_LABEL[l.targetType] ?? l.targetType}</p>
          {l.targetId && <p className="truncate font-mono text-[10px] text-slate-400" dir="ltr">{l.targetId}</p>}
        </div>
      ),
    },
    {
      key: 'meta',
      header: 'تفاصيل',
      hideOnMobile: true,
      render: (l) =>
        l.metadata ? (
          <code className="block max-w-56 truncate text-[11px] text-slate-500" dir="ltr" title={JSON.stringify(l.metadata)}>
            {JSON.stringify(l.metadata)}
          </code>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div>
      <PageTitle title="سجل العمليات الإدارية" subtitle={`${meta.total} عملية · للقراءة فقط`} />

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          className={`${inputClass} max-w-44`}
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">كل الأهداف</option>
          {Object.entries(TARGET_LABEL).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState icon="📜" title="لا توجد عمليات مسجّلة" />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <Pager page={meta.page} totalPages={meta.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
