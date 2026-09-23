import type { Prisma } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { applyBps } from '../lib/money.js';

type TxClient = Prisma.TransactionClient;

/**
 * تسوية مالية عند تسليم الطلب.
 * الدفع عند الاستلام: الموصّل يقبض الإجمالي نقدًا، لذا نسجّل الاستحقاقات فقط
 * ليمكن لاحقًا حساب التصفية بين المنصة والمحل والموصّل.
 *
 *   قيمة المنتجات  → استحقاق المحل ناقص عمولة المنصة
 *   رسوم التوصيل   → استحقاق الموصّل = رسوم التوصيل − حصة قفة الثابتة المثبّتة في الطلب
 */
export async function settleDeliveredOrder(
  tx: TxClient,
  order: {
    id: string;
    code: string;
    shopId: string;
    driverId: string | null;
    subtotal: number;
    deliveryFee: number;
    platformFee: number;
  },
  options: { commissionBps: number },
) {
  const commission = applyBps(order.subtotal, options.commissionBps);
  const shopNet = order.subtotal - commission;
  const driverEarning = order.driverId
    ? order.deliveryFee - Math.min(Math.max(0, order.platformFee), order.deliveryFee)
    : 0;

  // محفظة المحل
  const shopWallet = await tx.wallet.upsert({
    where: { shopId: order.shopId },
    update: {},
    create: { ownerType: 'SHOP', shopId: order.shopId },
  });
  await tx.wallet.update({
    where: { id: shopWallet.id },
    data: { balance: { increment: shopNet } },
  });
  await tx.walletTransaction.createMany({
    data: [
      {
        walletId: shopWallet.id,
        orderId: order.id,
        type: 'ORDER_EARNING',
        amount: order.subtotal,
        description: `قيمة منتجات الطلب ${order.code}`,
      },
      {
        walletId: shopWallet.id,
        orderId: order.id,
        type: 'PLATFORM_COMMISSION',
        amount: -commission,
        description: `عمولة المنصة على الطلب ${order.code}`,
      },
    ],
  });

  // محفظة الموصّل
  if (order.driverId && driverEarning > 0) {
    const driverWallet = await tx.wallet.upsert({
      where: { driverId: order.driverId },
      update: {},
      create: { ownerType: 'DRIVER', driverId: order.driverId },
    });
    await tx.wallet.update({
      where: { id: driverWallet.id },
      data: { balance: { increment: driverEarning } },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: driverWallet.id,
        orderId: order.id,
        type: 'DELIVERY_EARNING',
        amount: driverEarning,
        description: `أجرة توصيل الطلب ${order.code}`,
      },
    });
  }

  return { commission, shopNet, driverEarning };
}

/** محفظة المنصة (سجل واحد عام) */
export async function getPlatformWallet() {
  const existing = await prisma.wallet.findFirst({ where: { ownerType: 'PLATFORM' } });
  if (existing) return existing;
  return prisma.wallet.create({ data: { ownerType: 'PLATFORM' } });
}
