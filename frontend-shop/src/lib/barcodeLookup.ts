import type { BarcodeLookup } from './types';

export const SOURCE_LABEL = {
  OPEN_FOOD_FACTS: 'Open Food Facts',
  UPCITEMDB: 'UPCitemdb',
} as const;

/** رسالة واضحة للمحل حسب نتيجة البحث (قُفّة / مصدر خارجي / يدوي) */
export function lookupNotice(r: BarcodeLookup): string {
  if (r.status === 'NEW') {
    if (r.lookup?.externalUnavailable) {
      return 'لم نجد بيانات تلقائية لهذا الباركود. يمكنك إدخال بيانات المنتج ورفع الصورة يدويًا.';
    }
    return 'لم يتم العثور على المنتج — أدخل بياناته وسعرك، وارفع صورته.';
  }
  if (r.status === 'ALREADY_LISTED') {
    return 'هذا المنتج موجود في محلك بالفعل — يمكنك تعديل سعره وكميته.';
  }
  const noImage = r.product.imageUrl ? '' : ' لم نجد صورة لهذا المنتج — يمكنك رفع صورته.';
  const src = r.lookup?.source;
  if (src && src !== 'QOFFA') {
    const label = SOURCE_LABEL[src];
    if (r.lookup?.createdFromExternal) {
      return `تم العثور على المنتج من المصدر الخارجي (${label}) وتم حفظه في قُفّة. أدخل سعرك وكميتك وتوفّرك فقط.${noImage}`;
    }
    return `تم العثور على المنتج في قُفّة، وأُضيفت صورته تلقائيًا من ${label}. أدخل سعرك وكميتك وتوفّرك فقط.`;
  }
  return `تم العثور على المنتج في قُفّة. أدخل سعرك وكميتك وتوفّرك فقط.${noImage}`;
}
