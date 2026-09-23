import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCart } from '../lib/cart';
import { BagIcon, CartIcon, HomeIcon, UserIcon } from './icons';

const NAV = [
  { to: '/', label: 'الرئيسية', Icon: HomeIcon, end: true },
  { to: '/orders', label: 'طلباتي', Icon: BagIcon, end: false },
  { to: '/cart', label: 'السلة', Icon: CartIcon, end: false },
  { to: '/account', label: 'حسابي', Icon: UserIcon, end: false },
];

export default function Layout() {
  const { itemCount } = useCart();
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const location = useLocation();

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    api
      .notifications({ limit: 1, unreadOnly: true })
      .then((r) => setUnread(r.unreadCount))
      .catch(() => setUnread(0));
  }, [user, location.pathname]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-slate-50">
      <main className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)]">
        <Outlet context={{ unread }} />
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-2xl border-t border-slate-100 bg-white/95 shadow-[0_-4px_20px_rgba(15,23,42,0.05)] backdrop-blur">
        <ul className="grid h-16 grid-cols-4">
          {NAV.map(({ to, label, Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                    isActive ? 'text-brand-700' : 'text-slate-400'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute top-0 h-1 w-8 rounded-b-full bg-brand-600" aria-hidden />
                    )}
                    <span className="relative" aria-hidden>
                      <Icon className="size-6" />
                      {to === '/cart' && itemCount > 0 && (
                        <span className="absolute -top-1.5 -left-2.5 min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-white">
                          {itemCount > 99 ? '99+' : itemCount}
                        </span>
                      )}
                      {to === '/account' && unread > 0 && (
                        <span className="absolute -top-0.5 -left-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-white" />
                      )}
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
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
    <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
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
