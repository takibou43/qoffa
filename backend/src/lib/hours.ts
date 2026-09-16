/** أدوات ساعات العمل — الصيغة "HH:MM" بتوقيت المحل */

const toMinutes = (hhmm: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

/**
 * هل الوقت الحالي داخل ساعات العمل؟
 * يدعم الفترات التي تعبر منتصف الليل (مثال: 22:00 → 02:00).
 * عند وجود صيغة غير صالحة نعتبر المحل ضمن ساعات العمل حتى لا نمنع الخدمة بسبب إعداد خاطئ.
 */
export function isWithinWorkingHours(
  openingTime: string,
  closingTime: string,
  now: Date = new Date(),
): boolean {
  const open = toMinutes(openingTime);
  const close = toMinutes(closingTime);
  if (open === null || close === null) return true;
  if (open === close) return true; // مفتوح 24 ساعة

  const current = now.getHours() * 60 + now.getMinutes();
  return open < close
    ? current >= open && current < close
    : current >= open || current < close; // فترة تعبر منتصف الليل
}

/** المحل مفتوح فعليًا: المالك فعّل الفتح + الوقت ضمن ساعات العمل */
export function computeIsOpenNow(shop: {
  isOpen: boolean;
  openingTime: string;
  closingTime: string;
}): boolean {
  return shop.isOpen && isWithinWorkingHours(shop.openingTime, shop.closingTime);
}
