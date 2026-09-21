import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderAlertController, type ChannelLike } from '../src/lib/orderAlerts';

/** خادم وهمي: مصدر الحقيقة = مجموعة الطلبات PENDING */
class FakeServer {
  pending = new Set<string>();
  down = false;
  fetches = 0;
  fetchPending = async () => {
    this.fetches++;
    if (this.down) throw new Error('network');
    return [...this.pending];
  };
  /** قبول/رفض ناجح في الخادم */
  accept(id: string) {
    this.pending.delete(id);
  }
}

class Bus {
  private chans: Array<{ ch: ChannelLike; deliver: (m: unknown) => void }> = [];
  make(): ChannelLike {
    const listeners = new Set<(ev: { data: unknown }) => void>();
    const ch: ChannelLike = {
      postMessage: (m) => this.chans.forEach((o) => o.ch !== ch && o.deliver(m)),
      addEventListener: (_t, fn) => void listeners.add(fn),
      removeEventListener: (_t, fn) => void listeners.delete(fn),
      close: () => undefined,
    };
    this.chans.push({ ch, deliver: (m) => listeners.forEach((l) => l({ data: m })) });
    return ch;
  }
  drop(ch: ChannelLike) {
    this.chans = this.chans.filter((c) => c.ch !== ch);
  }
}

function setup(opts: { audio?: boolean; server?: FakeServer; channel?: ChannelLike; tabId?: string } = {}) {
  const server = opts.server ?? new FakeServer();
  const audio = { ready: opts.audio ?? true };
  const beeps = { n: 0 };
  const ctrl = new OrderAlertController({
    fetchPending: server.fetchPending,
    playBeep: () => void beeps.n++,
    isAudioReady: () => audio.ready,
    channel: opts.channel ?? null,
    tabId: opts.tabId,
  });
  return { server, audio, beeps, ctrl };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('تنبيه الطلبات — طلب واحد', () => {
  it('TEST 1: طلب جديد يظهر ويبدأ التنبيه فورًا', async () => {
    const { server, ctrl, beeps } = setup();
    server.pending.add('101');
    ctrl.start();
    await flush();
    expect(ctrl.getSnapshot().pendingIds).toEqual(['101']);
    expect(ctrl.getSnapshot().alerting).toBe(true);
    expect(beeps.n).toBe(1);
    ctrl.stop();
  });

  it('TEST 2: يستمر ويتكرر بفاصل 4 ثوانٍ (ليس متواصلًا ولا يتوقف تلقائيًا)', async () => {
    const { server, ctrl, beeps } = setup();
    server.pending.add('101');
    ctrl.start();
    await advance(20_000);
    expect(beeps.n).toBeGreaterThanOrEqual(5);
    expect(beeps.n).toBeLessThanOrEqual(6);
    await advance(60_000);
    expect(beeps.n).toBeGreaterThan(15);
    expect(ctrl.getSnapshot().count).toBe(1);
    ctrl.stop();
  });

  it('TEST 3/4: فتح/إغلاق التفاصيل وإخفاء النوافذ لا يمس الرنين (لا واجهة إيقاف إلا handled)', async () => {
    const { server, ctrl, beeps } = setup();
    server.pending.add('101');
    ctrl.start();
    await advance(8_000);
    const before = beeps.n;
    await ctrl.refresh();
    await ctrl.refresh();
    await advance(8_000);
    expect(beeps.n).toBeGreaterThan(before);
    expect(ctrl.getSnapshot().count).toBe(1);
    ctrl.stop();
  });

  it('TEST 5: Refresh لا يوقف الصوت ولا ينشئ إشعارًا مكررًا ولا رنينًا إضافيًا', async () => {
    const { server, ctrl, beeps } = setup();
    server.pending.add('101');
    ctrl.start();
    await flush();
    for (let i = 0; i < 10; i++) await ctrl.refresh();
    expect(ctrl.getSnapshot().pendingIds).toEqual(['101']);
    expect(beeps.n).toBe(1);
    ctrl.stop();
    // «Refresh» كامل للصفحة = متحكّم جديد: يقرأ الخادم فيجد الطلب PENDING ويستمر التنبيه
    const again = setup({ server });
    again.ctrl.start();
    await flush();
    expect(again.ctrl.getSnapshot().count).toBe(1);
    expect(again.beeps.n).toBe(1);
    again.ctrl.stop();
  });

  it('TEST 6/7: قبول أو رفض ناجح في الخادم يوقف التنبيه', async () => {
    for (let round = 0; round < 2; round++) {
      const { server, ctrl, beeps } = setup();
      server.pending.add('101');
      ctrl.start();
      await advance(9_000);
      server.accept('101'); // الخادم غيّر الحالة (ACCEPTED أو REJECTED)
      ctrl.handled('101');
      await flush();
      expect(ctrl.getSnapshot().count).toBe(0);
      const stopped = beeps.n;
      await advance(30_000);
      expect(beeps.n).toBe(stopped);
      ctrl.stop();
    }
  });

  it('TEST 8/9: فشل القبول/الرفض (الطلب PENDING) → الصوت لا يتوقف', async () => {
    const { server, ctrl, beeps } = setup();
    server.pending.add('101');
    ctrl.start();
    await advance(5_000);
    // الواجهة لا تستدعي handled عند الفشل؛ تكتفي بإعادة المزامنة
    await ctrl.refresh();
    const before = beeps.n;
    await advance(12_000);
    expect(beeps.n).toBeGreaterThan(before);
    expect(ctrl.getSnapshot().count).toBe(1);
    ctrl.stop();
  });

  it('حتى لو استُدعي handled خطأً والخادم ما زال PENDING: المزامنة تعيد الطلب ويستمر الرنين', async () => {
    const { server, ctrl } = setup();
    server.pending.add('101');
    ctrl.start();
    await flush();
    ctrl.handled('101');
    await flush();
    expect(ctrl.getSnapshot().pendingIds).toEqual(['101']);
    ctrl.stop();
  });
});

describe('تنبيه الطلبات — طلبات متعددة', () => {
  it('TEST 10: 3 طلبات = تنبيه واحد (لا أصوات متداخلة) والعدد 3', async () => {
    const one = setup();
    one.server.pending.add('101');
    one.ctrl.start();
    await advance(20_000);
    one.ctrl.stop();

    const three = setup();
    ['101', '102', '103'].forEach((i) => three.server.pending.add(i));
    three.ctrl.start();
    await advance(20_000);
    expect(three.ctrl.getSnapshot().count).toBe(3);
    expect(three.beeps.n).toBe(one.beeps.n);
    three.ctrl.stop();
  });

  it('TEST 11/12: قبول #101 ثم رفض #102 ثم قبول #103 → 2 ثم 1 ثم صمت كامل', async () => {
    const { server, ctrl, beeps } = setup();
    ['101', '102', '103'].forEach((i) => server.pending.add(i));
    ctrl.start();
    await advance(5_000);

    server.accept('101');
    ctrl.handled('101');
    await flush();
    expect(ctrl.getSnapshot().count).toBe(2);
    let b = beeps.n;
    await advance(9_000);
    expect(beeps.n).toBeGreaterThan(b);

    server.accept('102');
    ctrl.handled('102');
    await flush();
    expect(ctrl.getSnapshot().count).toBe(1);
    b = beeps.n;
    await advance(9_000);
    expect(beeps.n).toBeGreaterThan(b);

    server.accept('103');
    ctrl.handled('103');
    await flush();
    expect(ctrl.getSnapshot().count).toBe(0);
    b = beeps.n;
    await advance(30_000);
    expect(beeps.n).toBe(b);
    ctrl.stop();
  });

  it('TEST 13: نفس الحدث مرتين/مزامنات متزامنة → لا تكرار ولا رنين مضاعف', async () => {
    const bus = new Bus();
    const { server, ctrl, beeps } = setup({ channel: bus.make() });
    server.pending.add('101');
    ctrl.start();
    await Promise.all([ctrl.refresh(), ctrl.refresh(), ctrl.refresh()]);
    await flush();
    expect(ctrl.getSnapshot().pendingIds).toEqual(['101']);
    expect(beeps.n).toBe(1);
    server.pending.add('102');
    await ctrl.refresh();
    await ctrl.refresh();
    expect(ctrl.getSnapshot().pendingIds).toEqual(['101', '102']);
    ctrl.stop();
  });

  it('TEST 14: انقطاع الإنترنت لا يوقف الرنين، وعند العودة تُعاد المزامنة بلا تكرار', async () => {
    const { server, ctrl, beeps } = setup();
    server.pending.add('101');
    ctrl.start();
    await advance(5_000);
    server.down = true;
    const b = beeps.n;
    await advance(15_000);
    expect(ctrl.getSnapshot().online).toBe(false);
    expect(ctrl.getSnapshot().count).toBe(1);
    expect(beeps.n).toBeGreaterThan(b);

    server.pending.add('102'); // وصل طلب أثناء الانقطاع
    server.down = false;
    await ctrl.refresh(); // حدث online
    expect(ctrl.getSnapshot().online).toBe(true);
    expect(ctrl.getSnapshot().pendingIds).toEqual(['101', '102']);
    ctrl.stop();
  });

  it('المزامنة الدورية تلتقط الطلب الجديد بدون Refresh (مؤقت واحد)', async () => {
    const { server, ctrl, beeps } = setup();
    ctrl.start();
    await advance(3_000);
    expect(ctrl.getSnapshot().count).toBe(0);
    expect(beeps.n).toBe(0);
    server.pending.add('201');
    await advance(6_000);
    expect(ctrl.getSnapshot().count).toBe(1);
    expect(beeps.n).toBeGreaterThanOrEqual(1);
    ctrl.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('عدد الطلبات إلى الخادم محدود: مزامنة كل 5 ثوانٍ فقط', async () => {
    const { server, ctrl } = setup();
    server.pending.add('101');
    ctrl.start();
    await advance(60_000);
    expect(server.fetches).toBeLessThanOrEqual(14);
    ctrl.stop();
  });
});

describe('autoplay', () => {
  it('TEST 18: الصوت ممنوع → لا نغمة والطلب ظاهر؛ بعد تفاعل المستخدم يعمل فورًا', async () => {
    const { server, audio, ctrl, beeps } = setup({ audio: false });
    server.pending.add('101');
    ctrl.start();
    await advance(10_000);
    expect(beeps.n).toBe(0);
    expect(ctrl.getSnapshot().audioReady).toBe(false);
    expect(ctrl.getSnapshot().alerting).toBe(true);

    audio.ready = true; // ضغط «تفعيل تنبيهات الطلبات» → AudioContext running
    ctrl.audioUnlocked();
    expect(ctrl.getSnapshot().audioReady).toBe(true);
    expect(beeps.n).toBe(1);
    await advance(8_000);
    expect(beeps.n).toBeGreaterThanOrEqual(3);
    ctrl.stop();
  });

  it('فشل تشغيل النغمة لا يكسر التنبيه', async () => {
    const server = new FakeServer();
    server.pending.add('101');
    const ctrl = new OrderAlertController({
      fetchPending: server.fetchPending,
      playBeep: () => {
        throw new Error('locked');
      },
      isAudioReady: () => true,
    });
    ctrl.start();
    await flush();
    expect(ctrl.getSnapshot().count).toBe(1);
    ctrl.stop();
  });
});

describe('عدة تبويبات', () => {
  it('تبويب واحد فقط يرنّ، وعند إغلاقه يتولى الآخر', async () => {
    const bus = new Bus();
    const server = new FakeServer();
    server.pending.add('101');
    const chA = bus.make();
    const chB = bus.make();
    const A = setup({ server, channel: chA, tabId: 'a' });
    const B = setup({ server, channel: chB, tabId: 'b' });
    A.ctrl.start();
    B.ctrl.start();
    await advance(20_000);
    expect(B.beeps.n).toBe(0);
    expect(A.beeps.n).toBeGreaterThanOrEqual(5);

    A.ctrl.stop();
    bus.drop(chA);
    const before = B.beeps.n;
    await advance(15_000);
    expect(B.beeps.n).toBeGreaterThan(before);
    B.ctrl.stop();
  });

  it('قبول في تبويب يوقف الرنين في الآخر', async () => {
    const bus = new Bus();
    const server = new FakeServer();
    server.pending.add('101');
    const A = setup({ server, channel: bus.make(), tabId: 'a' });
    const B = setup({ server, channel: bus.make(), tabId: 'b' });
    A.ctrl.start();
    B.ctrl.start();
    await advance(6_000);
    server.accept('101');
    B.ctrl.handled('101');
    await flush();
    expect(A.ctrl.getSnapshot().count).toBe(0);
    const n = A.beeps.n;
    await advance(20_000);
    expect(A.beeps.n).toBe(n);
    A.ctrl.stop();
    B.ctrl.stop();
  });

  it('تبويب لا يستطيع تشغيل الصوت لا يسرق الرنين من تبويب قادر', async () => {
    const bus = new Bus();
    const server = new FakeServer();
    server.pending.add('101');
    const A = setup({ server, channel: bus.make(), tabId: 'a', audio: false });
    const B = setup({ server, channel: bus.make(), tabId: 'b' });
    A.ctrl.start();
    B.ctrl.start();
    await advance(10_000);
    expect(A.beeps.n).toBe(0);
    expect(B.beeps.n).toBeGreaterThanOrEqual(2);
    A.ctrl.stop();
    B.ctrl.stop();
  });
});

describe('يعمل من مستوى الـLayout (TEST 15–17: هيكلي)', () => {
  it('المزوّد يلفّ الـOutlet فيعمل التنبيه في كل الصفحات', () => {
    const layout = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8');
    expect(layout).toMatch(/<OrderAlertProvider>\s*<LayoutInner \/>\s*<\/OrderAlertProvider>/);
    expect(layout).toContain('<OrderAlertBanner />');
    expect(layout).toContain('<Outlet />');

    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    for (const page of ['<Dashboard />', '<Products />', '<Settings />', '<Orders />', '<Notifications />']) {
      expect(app).toContain(page);
    }
    expect(app.match(/<Layout \/>/g)).toHaveLength(1);
  });
});
