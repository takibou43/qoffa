/**
 * كل المبالغ أعداد صحيحة بالدينار الجزائري.
 * النِسَب تُحسب بالنقاط الأساسية (bps): 1000 bps = 10%.
 */
export function applyBps(amount: number, bps: number): number {
  return Math.round((amount * bps) / 10_000);
}

export const CURRENCY = 'DZD' as const;
