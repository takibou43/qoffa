import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { paginated, type Pagination } from '../../lib/pagination.js';
import { prisma, type Prisma } from '../../lib/prisma.js';

interface RatingInput {
  rating: number;
  comment?: string | null;
}

/** يعيد حساب متوسط التقييم من الصفر — أدق من التحديث التراكمي */
async function recomputeShopRating(tx: Prisma.TransactionClient, shopId: string) {
  const agg = await tx.review.aggregate({
    where: { shopId, targetType: 'SHOP' },
    _avg: { rating: true },
    _count: { rating: true },
  });
  await tx.shop.update({
    where: { id: shopId },
    data: {
      ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10,
      ratingCount: agg._count.rating,
    },
  });
}

async function recomputeDriverRating(tx: Prisma.TransactionClient, driverId: string) {
  const agg = await tx.review.aggregate({
    where: { driverId, targetType: 'DRIVER' },
    _avg: { rating: true },
    _count: { rating: true },
  });
  await tx.driverProfile.update({
    where: { id: driverId },
    data: {
      ratingAvg: Math.round((agg._avg.rating ?? 0) * 10) / 10,
      ratingCount: agg._count.rating,
    },
  });
}

/**
 * تقييم طلب مُسلَّم. التقييم مرة واحدة فقط لكل هدف
 * (مضمون أيضًا على مستوى قاعدة البيانات بقيد @@unique([orderId, targetType])).
 */
export async function reviewOrder(
  orderId: string,
  customerId: string,
  input: { shop?: RatingInput; driver?: RatingInput },
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerId: true,
      status: true,
      shopId: true,
      driverId: true,
      reviews: { select: { targetType: true } },
    },
  });
  if (!order) throw notFound('الطلب غير موجود');
  if (order.customerId !== customerId) throw forbidden('لا يمكنك تقييم طلب ليس لك');
  if (order.status !== 'DELIVERED') {
    throw conflict('لا يمكن التقييم إلا بعد تسليم الطلب');
  }

  const existing = new Set(order.reviews.map((r) => r.targetType));
  if (input.shop && existing.has('SHOP')) throw conflict('سبق أن قيّمت هذا المحل لهذا الطلب');
  if (input.driver && existing.has('DRIVER')) {
    throw conflict('سبق أن قيّمت الموصّل لهذا الطلب');
  }
  if (input.driver && !order.driverId) {
    throw conflict('لا يوجد موصّل مرتبط بهذا الطلب');
  }

  return prisma.$transaction(async (tx) => {
    const created = [];

    if (input.shop) {
      created.push(
        await tx.review.create({
          data: {
            orderId,
            authorId: customerId,
            targetType: 'SHOP',
            shopId: order.shopId,
            rating: input.shop.rating,
            comment: input.shop.comment ?? null,
          },
          select: { id: true, targetType: true, rating: true, comment: true, createdAt: true },
        }),
      );
      await recomputeShopRating(tx, order.shopId);
    }

    if (input.driver && order.driverId) {
      created.push(
        await tx.review.create({
          data: {
            orderId,
            authorId: customerId,
            targetType: 'DRIVER',
            driverId: order.driverId,
            rating: input.driver.rating,
            comment: input.driver.comment ?? null,
          },
          select: { id: true, targetType: true, rating: true, comment: true, createdAt: true },
        }),
      );
      await recomputeDriverRating(tx, order.driverId);
    }

    return created;
  });
}

export async function listShopReviews(shopId: string, pagination: Pagination) {
  const where = { shopId, targetType: 'SHOP' as const };
  const [items, total] = await Promise.all([
    prisma.review.findMany({
      where,
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        author: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    prisma.review.count({ where }),
  ]);
  return paginated(items, total, pagination);
}
