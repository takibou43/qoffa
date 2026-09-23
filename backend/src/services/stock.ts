/**
 * قُفّة — حجز المخزون وإعادته.
 *
 * - الخصم يتم عند إنشاء الطلب داخل نفس معاملة الإنشاء (حجز فوري: لا بيع لما لم يعد موجودًا).
 * - كل خصم هو UPDATE مشروط ذري: `stock >= الكمية` — قاعدة البيانات تُسلسل الطلبات المتزامنة
 *   على نفس الصف، فلا يمكن أن يصبح المخزون سالبًا ولا أن يُباع نفس الشيء مرتين.
 * - stock = null يعني "غير متتبَّع" → لا خصم ولا إعادة.
 * - الإعادة تتم مرة واحدة فقط (علَم Order.stockReserved يُطالَب به ذريًا).
 */
import { conflict } from '../lib/errors.js';
import type { Prisma } from '../lib/prisma.js';
import type { OrderStatus } from '../generated/prisma/enums.js';

export interface StockLine {
  shopProductId: string;
  quantity: number;
  name: string;
}

/**
 * يخصم الكميات ذريًا. يعيد خريطة shopProductId → الكمية المخصومة فعلًا (0 للمخزون غير المتتبَّع).
 * يرمي 409 إن كانت أي كمية أكبر من المتوفر — ويُلغي معها كل الخصومات السابقة لأن المعاملة تُرجَع.
 */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  lines: StockLine[],
): Promise<Map<string, number>> {
  const reserved = new Map<string, number>();
  const shortages: { productId: string; name: string; requested: number; available: number }[] = [];

  // ترتيب ثابت للأقفال يمنع الـdeadlock بين طلبين متزامنين على نفس المنتجات
  const ordered = [...lines].sort((a, b) => (a.shopProductId < b.shopProductId ? -1 : 1));

  for (const line of ordered) {
    const res = await tx.shopProduct.updateMany({
      where: { id: line.shopProductId, stock: { gte: line.quantity } },
      data: { stock: { decrement: line.quantity } },
    });
    if (res.count === 1) {
      reserved.set(line.shopProductId, line.quantity);
      continue;
    }
    const current = await tx.shopProduct.findUnique({
      where: { id: line.shopProductId },
      select: { stock: true },
    });
    if (current && current.stock === null) {
      reserved.set(line.shopProductId, 0); // غير متتبَّع
      continue;
    }
    shortages.push({
      productId: line.shopProductId,
      name: line.name,
      requested: line.quantity,
      available: Math.max(0, current?.stock ?? 0),
    });
  }

  if (shortages.length > 0) {
    const first = shortages[0]!;
    const message =
      shortages.length === 1
        ? first.available === 0
          ? `نفدت كمية «${first.name}» من المخزون`
          : `الكمية المطلوبة من «${first.name}» غير متوفرة. المتوفر حاليًا: ${first.available}`
        : 'الكمية المطلوبة من بعض المنتجات أكبر من المخزون المتوفر';
    throw conflict(message, { products: shortages.map((s) => s.name), shortages });
  }

  return reserved;
}

/** الحالات التي لم تغادر فيها البضاعة المحل بعد — الإلغاء منها يعيد الكمية للمخزون */
const RESTOCKABLE_FROM: readonly OrderStatus[] = [
  'PENDING',
  'SHOP_ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DRIVER_ASSIGNED',
  'NO_DRIVER',
];

export const shouldRestock = (from: OrderStatus, to: OrderStatus): boolean =>
  (to === 'REJECTED' || to === 'CANCELLED') && RESTOCKABLE_FROM.includes(from);

/**
 * يعيد الكميات المحجوزة للمخزون مرة واحدة فقط.
 * الطلبات القديمة (قبل هذه الميزة) لها stockReserved = false → لا شيء يُعاد.
 */
export async function releaseStock(tx: Prisma.TransactionClient, orderId: string): Promise<boolean> {
  const claimed = await tx.order.updateMany({
    where: { id: orderId, stockReserved: true },
    data: { stockReserved: false },
  });
  if (claimed.count === 0) return false;

  const items = await tx.orderItem.findMany({
    where: { orderId, productId: { not: null }, reservedQty: { gt: 0 } },
    select: { productId: true, reservedQty: true },
    orderBy: { productId: 'asc' },
  });
  for (const item of items) {
    // إن حُذف العرض أو صار غير متتبَّع لاحقًا فلا شيء يُعاد إليه
    await tx.shopProduct.updateMany({
      where: { id: item.productId!, stock: { not: null } },
      data: { stock: { increment: item.reservedQty } },
    });
  }
  return true;
}
