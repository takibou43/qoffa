/**
 * الحساب المالي للطلب بين الزبون والمحل والموصّل — المصدر الوحيد لهذه الأرقام.
 *
 * مثال: منتجات 2000 + توصيل 200 = 2200
 *   - الموصّل يدفع للمحل عند الاستلام: 2000 (قيمة المنتجات فقط)
 *   - الموصّل يقبض من الزبون عند التسليم: 2200 (الإجمالي)
 *   - يبقى مع الموصّل نقدًا: 200 (رسوم التوصيل)
 *
 * المحل لا يرى رسوم التوصيل ولا الإجمالي إطلاقًا — انظر toShopOrderView.
 * كل المبالغ أعداد صحيحة بالدينار.
 */

export interface OrderAmounts {
  subtotal: number;
  deliveryFee: number;
  total: number;
}

export interface OrderSettlement {
  /** قيمة المنتجات */
  productsAmount: number;
  /** رسوم التوصيل */
  deliveryFee: number;
  /** الخصم إن وجد (0 حاليًا — لا يوجد نظام خصومات) */
  discount: number;
  /** المبلغ النهائي الذي يدفعه الزبون */
  total: number;
  /** ما يدفعه الموصّل للمحل عند الاستلام */
  driverPaysShop: number;
  /** ما يقبضه الموصّل من الزبون عند التسليم */
  driverCollectsFromCustomer: number;
  /** ما يبقى مع الموصّل نقدًا (أجرة التوصيل) */
  driverKeeps: number;
}

export function orderSettlement(order: OrderAmounts): OrderSettlement {
  const discount = Math.max(0, order.subtotal + order.deliveryFee - order.total);
  return {
    productsAmount: order.subtotal,
    deliveryFee: order.deliveryFee,
    discount,
    total: order.total,
    driverPaysShop: order.subtotal,
    driverCollectsFromCustomer: order.total,
    driverKeeps: order.total - order.subtotal,
  };
}

/** الحقول المالية التي لا يجوز أن تصل للمحل أبدًا */
const SHOP_HIDDEN_FIELDS = [
  'deliveryFee',
  'total',
  'driverEarning',
  'commissionAmount',
  'settlement',
  'deliveryPin',
  'deliveryPinAttempts',
  'deliveryQr',
] as const;

/**
 * نسخة الطلب كما يراها المحل: قيمة المنتجات فقط، والمبلغ الذي يستلمه من الموصّل.
 * لا رسوم توصيل ولا إجمالي شامل للتوصيل.
 */
export function toShopOrderView<T extends { subtotal: number }>(order: T) {
  const view: Record<string, unknown> = { ...order };
  for (const f of SHOP_HIDDEN_FIELDS) delete view[f];
  view.productsAmount = order.subtotal;
  view.amountFromDriver = order.subtotal;
  return view as Omit<T, (typeof SHOP_HIDDEN_FIELDS)[number]> & {
    productsAmount: number;
    amountFromDriver: number;
  };
}
