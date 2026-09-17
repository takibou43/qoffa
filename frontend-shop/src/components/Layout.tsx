import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'اللوحة', icon: '📊', end: true },
  { to: '/orders', label: 'الطلبات', icon: '🧾', end: false },
  { to: '/products', label: 'المنتجات', icon: '📦', end: false },
  { to: '/settings', label: 'المحل', icon: '🏪', end: false },
];

export default function Layout() {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const location = useLocation();

  useEffect(() => {
    if (!user) return;
    api
      .notifications({ limit: 1, unreadOnly: true })
      .then((r) => setUnread(r.unreadCount))
      .catch(() => undefined);
  }, [user, location.pathname]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col bg-slate-50">
      <main className="flex-1 pb-20">
        <Outlet />
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-3xl border-t border-slate-200 bg-white/95 backdrop-blur">
        <ul className="grid grid-cols-5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                    isActive ? 'text-brand-700' : 'text-slate-500'
                  }`
                }
              >
                <span className="text-xl leading-none" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            </li>
          ))}
          <li>
            <NavLink
              to="/notifications"
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${
                  isActive ? 'text-brand-700' : 'text-slate-500'
                }`
              }
            >
              <span className="relative text-xl leading-none" aria-hidden>
                🔔
                {unread > 0 && (
                  <span className="absolute -top-1 -left-2 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white">
                    {unread}
                  </span>
                )}
              </span>
              الإشعارات
            </NavLink>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}
