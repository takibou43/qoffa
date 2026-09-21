/**
 * نغمة تنبيه الطلبات عبر Web Audio (بلا ملفات صوت ولا مكتبات).
 * المتصفحات تمنع الصوت قبل تفاعل المستخدم: نُنشئ AudioContext ونستأنفه من ضغطة المستخدم (unlockAudio)،
 * ويُعدّ الصوت جاهزًا فقط حين تكون حالته running.
 */

type AudioCtxCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function getCtor(): AudioCtxCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isAudioReady(): boolean {
  return ctx !== null && ctx.state === 'running';
}

/** يُستدعى من معالج ضغطة مستخدم فقط */
export async function unlockAudio(): Promise<boolean> {
  const Ctor = getCtor();
  if (!Ctor) return false;
  try {
    if (!ctx) ctx = new Ctor();
    if (ctx.state !== 'running') await ctx.resume();
    // نغمة صامتة قصيرة لإتمام فتح الصوت على iOS/Safari
    const g = ctx.createGain();
    g.gain.value = 0;
    const o = ctx.createOscillator();
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.01);
  } catch {
    return false;
  }
  return isAudioReady();
}

/** نغمتان قصيرتان واضحتان (~0.7 ثانية) — ليست صوتًا متواصلًا */
export function playBeep(): void {
  if (!ctx || ctx.state !== 'running') throw new Error('audio-locked');
  const c = ctx;
  const t0 = c.currentTime;
  const tone = (freq: number, start: number, dur: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.02);
  };
  tone(880, 0, 0.3);
  tone(1174, 0.35, 0.35);
}
