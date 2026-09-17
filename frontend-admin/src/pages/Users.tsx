import { useCallback, useEffect, useState } from 'react';
import { Chip, DataTable, Pager, type Column } from '../components/DataTable';
import { PageTitle } from '../components/Layout';
import { Alert, Button, EmptyState, Field, LoadingBlock, inputClass } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import type { Role, User } from '../lib/types';

const ROLE_LABEL: Record<Role, string> = {
  CUSTOMER: 'زبون',
  SHOP_OWNER: 'صاحب محل',
  DRIVER: 'موصّل',
  ADMIN: 'مدير',
  SUPER_ADMIN: 'مالك المنصة',
};

export default function Users() {
  const { user: me } = useAuth();
  const isSuper = me?.role === 'SUPER_ADMIN';

  const [rows, setRows] = useState<User[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [role, setRole] = useState<Role | ''>('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', password: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      .users({
        role: role || undefined,
        status: status || undefined,
        q: search || undefined,
        page,
        limit: 20,
      })
      .then((r) => {
        setRows(r.items);
        setMeta({ page: r.meta.page, totalPages: r.meta.totalPages, total: r.meta.total });
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [role, status, search, page]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleStatus(row: User) {
    const next = row.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setError(null);
    setBusy(row.id);
    try {
      await api.setUserStatus(row.id, next);
      await load();
    } catch (e) {
      // 403 من الخادم عند محاولة المساس بمالك المنصة أو بمدير من مدير عادي
      setError(e instanceof ApiError ? e.message : 'تعذّر تنفيذ العملية.');
    } finally {
      setBusy(null);
    }
  }

  async function createAdmin() {
    setFormError(null);
    setCreated(null);
    setSaving(true);
    try {
      const r = await api.createAdmin({
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      setCreated(`تم إنشاء المدير «${r.user.fullName}». سيُطلب منه تغيير كلمة المرور عند أول دخول.`);
      setForm({ fullName: '', phone: '', email: '', password: '' });
      setShowCreate(false);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.details?.length) {
        setFormError(e.details.map((d) => d.message).join(' · '));
      } else {
        setFormError(e instanceof ApiError ? e.message : 'تعذّر إنشاء المدير.');
      }
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'المستخدم',
      render: (u) => (
        <div>
          <p className="font-medium text-slate-900">{u.fullName}</p>
          <p className="text-xs text-slate-500" dir="ltr">{u.phone}</p>
        </div>
      ),
    },
    { key: 'role', header: 'الدور', render: (u) => <Chip tone="muted">{ROLE_LABEL[u.role]}</Chip> },
    {
      key: 'status',
      header: 'الحالة',
      render: (u) =>
        u.status === 'ACTIVE' ? <Chip tone="ok">فعّال</Chip> : <Chip tone="bad">معلّق</Chip>,
    },
    {
      key: 'created',
      header: 'التسجيل',
      hideOnMobile: true,
      render: (u) => <span className="text-xs text-slate-500">{formatDateTime(u.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (u) => {
        // مالك المنصة محميّ في الخادم؛ نُخفي الزر أيضًا لوضوح الواجهة
        if (u.role === 'SUPER_ADMIN') return <span className="text-xs text-slate-400">محميّ</span>;
        if (u.role === 'ADMIN' && !isSuper) {
          return <span className="text-xs text-slate-400">لمالك المنصة</span>;
        }
        if (u.id === me?.id) return <span className="text-xs text-slate-400">حسابك</span>;
        return (
          <button
            type="button"
            disabled={busy === u.id}
            onClick={() => toggleStatus(u)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              u.status === 'ACTIVE' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
            } disabled:opacity-50`}
          >
            {u.status === 'ACTIVE' ? 'تعليق' : 'إعادة تفعيل'}
          </button>
        );
      },
    },
  ];

  return (
    <div>
      <PageTitle title="المستخدمون" subtitle={`${meta.total} مستخدم`} />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بحث بالاسم أو الهاتف…"
          className={`${inputClass} max-w-xs`}
        />
        <select
          className={`${inputClass} max-w-40`}
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role | '');
            setPage(1);
          }}
        >
          <option value="">كل الأدوار</option>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
          ))}
        </select>
        <select
          className={`${inputClass} max-w-36`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">كل الحالات</option>
          <option value="ACTIVE">فعّال</option>
          <option value="SUSPENDED">معلّق</option>
        </select>

        {isSuper && (
          <Button onClick={() => setShowCreate(true)} className="mr-auto">
            + إضافة مدير
          </Button>
        )}
      </div>

      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {created && <div className="mb-3"><Alert kind="success">{created}</Alert></div>}

      {loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState icon="👥" title="لا توجد نتائج" />
      ) : (
        <>
          <DataTable columns={columns} rows={rows} />
          <Pager page={meta.page} totalPages={meta.totalPages} onChange={setPage} />
        </>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-5">
            <h3 className="mb-1 text-lg font-bold text-slate-900">إضافة مدير</h3>
            <p className="mb-4 text-xs text-slate-500">
              يُنشأ بدور «مدير» فقط. لا يمكن إنشاء مالك منصة من أي واجهة.
            </p>
            <div className="space-y-3">
              <Field label="الاسم الكامل">
                <input className={inputClass} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </Field>
              <Field label="رقم الهاتف">
                <input className={inputClass} dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="البريد الإلكتروني">
                <input className={inputClass} type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="كلمة مرور مؤقتة" hint="10 أحرف على الأقل — يُجبر على تغييرها">
                <input className={inputClass} type="text" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
              {formError && <Alert>{formError}</Alert>}
              <div className="flex gap-2 pt-1">
                <Button className="flex-1" onClick={createAdmin} loading={saving}>إنشاء</Button>
                <Button variant="secondary" className="flex-1" onClick={() => setShowCreate(false)}>إلغاء</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
