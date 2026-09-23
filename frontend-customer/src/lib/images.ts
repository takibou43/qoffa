import type { OrderItem } from './types';

/**
 * صورة سطر الطلب: الصورة الحالية للمنتج العالمي (للعرض فقط).
 * لقطة الطلب (الاسم/السعر) لا تتأثر؛ وإن حُذف المنتج من المحل أو حُذفت صورته → null فيظهر البديل.
 */
export function orderItemImage(item: Pick<OrderItem, 'product'>): string | null {
  return item.product?.product?.imageUrl ?? null;
}
