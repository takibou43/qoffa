/**
 * نظام تنبيه الطلبات الجديدة (منطق خالص بلا React ولا DOM — قابل للاختبار).
 *
 * المبادئ:
 *  - مصدر الحقيقة هو الخادم: مجموعة الطلبات «PENDING» تُستبدل بما يعيده الخادم في كل مزامنة.
 *    لا توجد حالة إشعار مستقلة؛ التنبيه = (عدد الطلبات المعلّقة > 0).
 *  - الطلب يُعرَّف بمعرّفه (Set) فلا تكرار مهما تكرر الحدث أو المزامنة.
 *  - مؤقّت واحد فقط (tick كل ثانية) يقود المزامنة الدورية والرنين والنبضة بين التبويبات.
 *  - لا يتوقف الرنين بفتح الطلب أو التحديث أو إغلاق نافذة؛ يتوقف فقط حين يخلو الخادم من PENDING
 *    (أي بعد قبول/رفض نجح فعليًا في الخادم). فشل القبول/الرفض لا يغيّر شيئًا فيستمر الرنين.
 *  - تبويب واحد فقط يرنّ (انتخاب بالأصغر معرّفًا بين التبويبات القادرة على التشغيل) عبر BroadcastChannel.
 */

export interface ChannelLike {
  postMessage(msg: unknown): void;
  addEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void;
  removeEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void;
  close(): void;
}

export interface AlertDeps {
  /** كل معرّفات الطلبات PENDING لدى الخادم (يرمي عند الفشل) */
  fetchPending: () => Promise<string[]>;
  /** يشغّل نغمة واحدة (قد يرمي إن منع المتصفح الصوت) */
  playBeep: () => void | Promise<void>;
  /** هل الصوت مفعَّل الآن (AudioContext running) */
  isAudioReady: () => boolean;
  channel?: ChannelLike | null;
  tabId?: string;
  now?: () => number;
  /** فاصل الرنين (مللي ثانية) — 4 ثوانٍ */
  ringEveryMs?: number;
  /** فاصل المزامنة الدورية — 5 ثوانٍ */
  pollEveryMs?: number;
  tickMs?: number;
}

export interface AlertState {
  pendingIds: string[];
  count: number;
  audioReady: boolean;
  /** هل هذا التبويب هو المسؤول عن الرنين الآن */
  isLeader: boolean;
  /** هل يوجد طلب معلّق يحتاج قرارًا (بصرف النظر عن إمكانية تشغيل الصوت) */
  alerting: boolean;
  online: boolean;
  lastError: string | null;
}

type Msg =
  | { t: 'hb'; id: string; canPlay: boolean }
  | { t: 'handled'; id: string }
  | { t: 'refresh' };

export class OrderAlertController {
  private pending = new Set<string>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private peers = new Map<string, { canPlay: boolean; ts: number }>();
  private sinceRing = Infinity;
  private sincePoll = 0;
  private polling = false;
  private online = true;
  private lastError: string | null = null;
  private snapshot: AlertState;
  private readonly tabId: string;
  private readonly now: () => number;
  private readonly ringEvery: number;
  private readonly pollEvery: number;
  private readonly tick: number;
  private audioReady = false;
  private readonly onMessage = (ev: { data: unknown }) => this.receive(ev.data as Msg);

  constructor(private readonly deps: AlertDeps) {
    this.tabId = deps.tabId ?? Math.random().toString(36).slice(2);
    this.now = deps.now ?? (() => Date.now());
    this.ringEvery = deps.ringEveryMs ?? 4000;
    this.pollEvery = deps.pollEveryMs ?? 5000;
    this.tick = deps.tickMs ?? 1000;
    this.snapshot = this.compute();
  }

  /* ── واجهة الاشتراك (useSyncExternalStore) ── */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;

  private emit() {
    const next = this.compute();
    const prev = this.snapshot;
    const same =
      prev.count === next.count &&
      prev.audioReady === next.audioReady &&
      prev.isLeader === next.isLeader &&
      prev.online === next.online &&
      prev.lastError === next.lastError &&
      prev.pendingIds.join() === next.pendingIds.join();
    if (same) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }

  private compute(): AlertState {
    const ids = [...this.pending];
    return {
      pendingIds: ids,
      count: ids.length,
      audioReady: this.audioReady,
      isLeader: this.isLeader(),
      alerting: ids.length > 0,
      online: this.online,
      lastError: this.lastError,
    };
  }

  /* ── دورة الحياة ── */
  start() {
    if (this.timer) return;
    this.deps.channel?.addEventListener('message', this.onMessage);
    this.audioReady = this.deps.isAudioReady();
    this.sinceRing = Infinity;
    this.post({ t: 'hb', id: this.tabId, canPlay: this.audioReady });
    void this.refresh();
    this.timer = setInterval(() => this.onTick(), this.tick);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.deps.channel?.removeEventListener('message', this.onMessage);
  }

  /** مزامنة فورية مع الخادم (عند الرجوع للتبويب/عودة الاتصال/بعد قبول أو رفض) */
  async refresh(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const ids = await this.deps.fetchPending();
      this.online = true;
      this.lastError = null;
      const wasEmpty = this.pending.size === 0;
      this.pending = new Set(ids); // الخادم هو الحقيقة: استبدال لا إضافة
      if (wasEmpty && this.pending.size > 0) this.sinceRing = Infinity; // رنين فوري عند أول طلب
      if (this.pending.size === 0) this.sinceRing = Infinity;
    } catch (e) {
      // فشل الشبكة لا يمسح شيئًا: الطلبات المعروفة تبقى معلّقة والرنين يستمر
      this.online = false;
      this.lastError = e instanceof Error ? e.message : 'network';
    } finally {
      this.polling = false;
      this.emit();
      this.maybeRing();
    }
  }

  /**
   * يُستدعى بعد نجاح قبول/رفض في الخادم فقط (لا عند مجرد الضغط).
   * يزيل الطلب محليًا فورًا ثم يتأكد من الخادم.
   */
  handled(orderId: string) {
    this.pending.delete(orderId);
    if (this.pending.size === 0) this.sinceRing = Infinity;
    this.post({ t: 'handled', id: orderId });
    this.emit();
    void this.refresh();
  }

  /** بعد تفعيل المستخدم للصوت (ضغط زر) */
  audioUnlocked() {
    this.audioReady = this.deps.isAudioReady();
    this.sinceRing = Infinity;
    this.emit();
    this.maybeRing();
  }

  /* ── المؤقت الوحيد ── */
  private onTick() {
    this.sinceRing += this.tick;
    this.sincePoll += this.tick;

    const ready = this.deps.isAudioReady();
    if (ready !== this.audioReady) {
      this.audioReady = ready;
      this.emit();
    }

    this.post({ t: 'hb', id: this.tabId, canPlay: this.audioReady });
    this.pruneAndRecomputeLeader();

    if (this.sincePoll >= this.pollEvery) {
      this.sincePoll = 0;
      void this.refresh();
    }
    this.maybeRing();
  }

  private pruneAndRecomputeLeader() {
    const t = this.now();
    for (const [id, p] of this.peers) if (t - p.ts > this.tick * 3.5) this.peers.delete(id);
    this.emit();
  }

  private isLeader(): boolean {
    if (!this.audioReady) return false;
    const t = this.now();
    let min = this.tabId;
    for (const [id, p] of this.peers) {
      if (p.canPlay && t - p.ts <= this.tick * 3.5 && id < min) min = id;
    }
    return min === this.tabId;
  }

  private maybeRing() {
    if (this.pending.size === 0 || !this.audioReady || !this.isLeader()) return;
    if (this.sinceRing < this.ringEvery) return;
    this.sinceRing = 0;
    try {
      const r = this.deps.playBeep();
      if (r && typeof (r as Promise<void>).catch === 'function') {
        (r as Promise<void>).catch(() => {
          this.audioReady = false;
          this.emit();
        });
      }
    } catch {
      this.audioReady = false;
      this.emit();
    }
  }

  /* ── تنسيق التبويبات ── */
  private post(m: Msg) {
    try {
      this.deps.channel?.postMessage(m);
    } catch {
      /* القناة مغلقة */
    }
  }

  private receive(m: Msg) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hb' && m.id !== this.tabId) {
      const known = this.peers.has(m.id);
      this.peers.set(m.id, { canPlay: m.canPlay, ts: this.now() });
      // تبويب جديد ظهر: نردّ فورًا كي يعرف من هو المسؤول عن الرنين قبل أن يرنّ هو
      if (!known) this.post({ t: 'hb', id: this.tabId, canPlay: this.audioReady });
      this.emit();
    } else if (m.t === 'handled') {
      this.pending.delete(m.id);
      this.emit();
      void this.refresh();
    } else if (m.t === 'refresh') {
      void this.refresh();
    }
  }
}
