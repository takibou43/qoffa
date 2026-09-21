import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'اللوحة', icon: '📊', end: true },
  { to: '/orders', label: 'الطلبات', icon: '🧾', end: false },
  { to: '/shops', label: 'المحلات', icon: '🏪', end: false },
  { to: '/drivers', label: 'الموصّلون', icon: '🛵', end: false },
  { to: '/users', label: 'المستخدمون', icon: '👥', end: false },
  { to: '/delivery-pricing', label: 'أسعار التوصيل', icon: '💰', end: false },
  { to: '/audit-log', label: 'سجل العمليات', icon: '📜', end: false },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [owner, setOwner] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    api
      .platform()
      .then((r) => setOwner(r.platform.owner))
      .catch(() => undefined);
  }, []);

  const isSuper = user?.role === 'SUPER_ADMIN';

  return (
    <div className="min-h-dvh bg-slate-50 lg:flex">
      {/* الشريط الجانبي على سطح المكتب */}
      <aside className="hidden w-60 shrink-0 border-l border-slate-200 bg-white p-4 lg:block">
        <div className="mb-6">
          <h1 className="text-lg font-bold text-slate-900">قُفّة</h1>
          <p className="text-xs text-slate-500">إدارة المنصة</p>
        </div>
        <nav>
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium ${
                      isActive ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-6 rounded-xl bg-slate-50 p-3 text-xs">
          <p className="font-semibold text-slate-800">{user?.fullName}</p>
          <p className="text-slate-500">{isSuper ? 'مالك المنصة' : 'مدير'}</p>
          {isSuper && owner && (
            <p className="mt-1.5 truncate text-[11px] text-slate-400" dir="ltr" title={owner.email}>
              {owner.email}
            </p>
          )}
          <button type="button" onClick={logout} className="mt-2 text-red-600">
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* شريط علوي على الهاتف */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <div>
            <h1 className="text-base font-bold text-slate-900">قُفّة — الإدارة</h1>
            <p className="text-[11px] text-slate-500">
              {user?.fullName} · {isSuper ? 'مالك المنصة' : 'مدير'}
            </p>
          </div>
          <button type="button" onClick={logout} className="text-sm text-red-600">
            خروج
          </button>
        </header>

        <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                  isActive ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}
