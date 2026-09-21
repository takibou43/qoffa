import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { isAudioReady, playBeep, unlockAudio } from './alertSound';
import { OrderAlertController, type AlertState, type ChannelLike } from './orderAlerts';

/** كل معرّفات الطلبات PENDING لدى الخادم (يمشي على الصفحات؛ الحد الأقصى للصفحة 50) */
async function fetchPendingIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await api.orders({ bucket: 'new', limit: 50, page });
    ids.push(...r.items.map((o) => o.id));
    if (!r.meta.hasNext) break;
  }
  return ids;
}

interface Ctx {
  state: AlertState;
  /** يُستدعى بعد نجاح قبول/رفض في الخادم فقط */
  handled: (orderId: string) => void;
  refresh: () => void;
  enableSound: () => Promise<void>;
}

const AlertContext = createContext<Ctx | null>(null);

export function OrderAlertProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const controller = useMemo(() => {
    if (!userId) return null;
    const channel: ChannelLike | null =
      typeof BroadcastChannel !== 'undefined'
        ? (new BroadcastChannel(`qoffa-shop-order-alerts:${userId}`) as unknown as ChannelLike)
        : null;
    return new OrderAlertController({
      fetchPending: fetchPendingIds,
      playBeep,
      isAudioReady,
      channel,
    });
  }, [userId]);

  useEffect(() => {
    if (!controller) return;
    controller.start();

    const resync = () => void controller.refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') resync();
    };
    // أي ضغطة/لمسة أولى في التطبيق تفتح الصوت إن أمكن (سياسة autoplay تسمح بذلك بعد تفاعل المستخدم)
    const onGesture = () => {
      void unlockAudio().then(() => controller.audioUnlocked());
    };
    window.addEventListener('online', resync);
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });

    return () => {
      controller.stop();
      window.removeEventListener('online', resync);
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [controller]);

  const idle: AlertState = useMemo(
    () => ({
      pendingIds: [],
      count: 0,
      audioReady: false,
      isLeader: false,
      alerting: false,
      online: true,
      lastError: null,
    }),
    [],
  );
  const state = useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getSnapshot : () => idle,
  );

  const value = useMemo<Ctx>(
    () => ({
      state,
      handled: (id) => controller?.handled(id),
      refresh: () => void controller?.refresh(),
      enableSound: async () => {
        await unlockAudio();
        controller?.audioUnlocked();
      },
    }),
    [state, controller],
  );

  return <AlertContext.Provider value={value}>{children}</AlertContext.Provider>;
}

const noopSubscribe = () => () => undefined;

export function useOrderAlerts(): Ctx {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useOrderAlerts must be used inside <OrderAlertProvider>');
  return ctx;
}
