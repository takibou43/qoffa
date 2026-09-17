import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Button, EmptyState } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLocation as useGeo } from '../lib/location';
import type { Address } from '../lib/types';

export default function Account() {
  const { user, logout, loading } = useAuth();
  const { coords, clear: clearLocation } = useGeo();
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    api.addresses().then((r) => setAddresses(r.items)).catch(() => setAddresses([]));
    api.notifications({ limit: 1, unreadOnly: true }).then((r) => setUnread(r.unreadCount)).catch(() => undefined);
  }, [user]);

  if (loading) return null;

  if (!user) {
    return (
      <>
        <PageHeader title="حسابي" />
        <EmptyState
          icon="👤"
          title="لم تسجّل الدخول"
          description="سجّل الدخول لمتابعة طلباتك وحفظ عناوينك."
          action={
            <Link to="/login">
              <Button>تسجيل الدخول</Button>
            </Link>
          }
        />
      </>
    );
  }

  return (
    <div>
      <PageHeader title="حسابي" />

      <div className="space-y-4 px-4 py-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-base font-bold text-slate-900">{user.fullName}</p>
          <p className="text-sm text-slate-500">{user.phone}</p>
        </section>

        <Link
          to="/notifications"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 active:scale-[0.99]"
        >
          <span className="text-sm font-medium text-slate-800">🔔 الإشعارات</span>
          {unread > 0 && (
            <span className="rounded-full bg-brand-700 px-2 py-0.5 text-xs font-bold text-white">
              {unread}
            </span>
          )}
        </Link>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-900">عناويني</h2>
          {addresses.length === 0 ? (
            <p className="text-sm text-slate-500">
              لا توجد عناوين محفوظة. يمكنك إدخال عنوانك عند تأكيد الطلب.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {addresses.map((address) => (
                <li key={address.id} className="rounded-xl bg-slate-50 p-3">
                  <span className="block font-medium text-slate-800">{address.label}</span>
                  <span className="block text-slate-500">
                    {address.addressLine}، {address.city}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-bold text-slate-900">الموقع</h2>
          <p className="text-sm text-slate-500">
            {coords ? 'تم حفظ موقعك التقريبي لعرض المحلات القريبة.' : 'لم يُحدَّد موقع.'}
          </p>
          {coords && (
            <button type="button" onClick={clearLocation} className="mt-2 text-sm text-red-600">
              حذف الموقع المحفوظ
            </button>
          )}
        </section>

        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            logout();
            navigate('/');
          }}
        >
          تسجيل الخروج
        </Button>

        <p className="pt-2 text-center text-xs text-slate-400">قُفّة — من حانوتك إلى بابك</p>
      </div>
    </div>
  );
}
