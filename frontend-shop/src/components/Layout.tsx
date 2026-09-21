import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { OrderAlertProvider, useOrderAlerts } from '../lib/orderAlertContext';

const NAV = [
  { to: '/', label: 'اللوحة', icon: '📊', end: true },
  { to: '/orders', label: 'الطلبات', icon: '🧾', end: false },
  { to: '/products', label: 'المنتجات', icon: '📦', end: false },
  { to: '/settings', label: 'المحل', icon: '🏪', end: false },
];

/** تنبيه الطلبات على مستوى الـLayout: يعمل في كل الصفحات لا في صفحة الطلبات وحدها */
function OrderAlertBanner() {
  const { state, enableSound } = useOrderAlerts();
  if (state.count === 0 && state.audioReady) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`sticky top-0 z-40 flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm font-bold text-white ${
        state.count > 0 ? 'bg-red-600' : 'bg-slate-600'
      }`}
    >
      <div className="min-w-0">
        {state.count > 0 ? (
          <Link to="/orders" className="block truncate underline-offset-2 hover:underline">
            🔔 {state.count === 1 ? 'لديك طلب ينتظر القبول أو الرفض' : `لديك ${state.count} طلبات تنتظر القبول أو الرفض`}
          </Link>
        ) : (
          <span>الصوت غير مفعّل</span>
        )}
        {!state.online && <div className="text-xs font-normal">لا اتصال بالخادم — نعيد المحاولة تلقائيًا…</div>}
      </div>
      {!state.audioReady && (
        <button
          type="button"
          onClick={() => void enableSound()}
          className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-red-700"
        >
          تفعيل تنبيهات الطلبات 🔔
        </button>
      )}
    </div>
  );
}

export default function Layout() {
  return (
    <OrderAlertProvider>
      <LayoutInner />
    </OrderAlertProvider>
  );
}

function LayoutInner() {
  const { user } = useAuth();
  const { state: alerts } = useOrderAlerts();
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
      <OrderAlertBanner />
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
                <span className="relative text-xl leading-none" aria-hidden>
                  {item.icon}
                  {item.to === '/orders' && alerts.count > 0 && (
                    <span className="absolute -top-1 -left-2 min-w-4 animate-pulse rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">
                      {alerts.count}
                    </span>
                  )}
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
