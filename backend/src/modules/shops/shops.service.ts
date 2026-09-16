import { forbidden, notFound } from '../../lib/errors.js';
import { boundingBox, haversineMeters } from '../../lib/geo.js';
import { computeIsOpenNow } from '../../lib/hours.js';
import { paginated, type Pagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import type { NearbyShopsQuery } from './shops.schema.js';

/** الحقول التي يراها الزبون — لا تتضمن بيانات المالك */
export const publicShopSelect = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  phone: true,
  addressLine: true,
  city: true,
  latitude: true,
  longitude: true,
  isOpen: true,
  openingTime: true,
  closingTime: true,
  deliveryFee: true,
  ratingAvg: true,
  ratingCount: true,
  category: { select: { id: true, name: true, slug: true } },
} as const;

type ShopRow = {
  isOpen: boolean;
  openingTime: string;
  closingTime: string;
  latitude: number;
  longitude: number;
};

/** يضيف isOpenNow (يجمع بين مفتاح المالك وساعات العمل) والمسافة إن توفر الموقع */
function decorate<T extends ShopRow>(shop: T, lat?: number, lon?: number) {
  return {
    ...shop,
    isOpenNow: computeIsOpenNow(shop),
    distanceMeters:
      typeof lat === 'number' && typeof lon === 'number'
        ? haversineMeters(lat, lon, shop.latitude, shop.longitude)
        : null,
  };
}

/**
 * المحلات القريبة.
 * تصفية أولية بصندوق إحاطة (يستفيد من index على latitude/longitude)،
 * ثم مسافة Haversine دقيقة وترتيب تصاعدي. كافٍ لحجم MVP دون PostGIS.
 */
export async function listNearbyShops(query: NearbyShopsQuery) {
  const { lat, lon, q, categoryId, openOnly, page, limit } = query;
  const radiusKm = query.radiusKm ?? env.SEARCH_RADIUS_KM;

  const where: Record<string, unknown> = {
    status: 'APPROVED',
    ...(openOnly ? { isOpen: true } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
  };

  const hasLocation = typeof lat === 'number' && typeof lon === 'number';
  if (hasLocation) {
    const box = boundingBox(lat, lon, radiusKm);
    where.latitude = { gte: box.minLat, lte: box.maxLat };
    where.longitude = { gte: box.minLon, lte: box.maxLon };
  }

  if (!hasLocation) {
    // بدون موقع: ترتيب بالتقييم ثم الأحدث، مع pagination في قاعدة البيانات
    const [items, total] = await Promise.all([
      prisma.shop.findMany({
        where,
        select: publicShopSelect,
        orderBy: [{ isOpen: 'desc' }, { ratingAvg: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.shop.count({ where }),
    ]);
    return paginated(
      items.map((s) => decorate(s)),
      total,
      { page, limit },
    );
  }

  // مع موقع: نقرأ حتى 300 محل داخل الصندوق ثم نرتب بالمسافة
  const candidates = await prisma.shop.findMany({
    where,
    select: publicShopSelect,
    take: 300,
  });

  const radiusM = radiusKm * 1000;
  const withDistance = candidates
    .map((s) => decorate(s, lat, lon))
    .filter((s) => (s.distanceMeters as number) <= radiusM)
    .filter((s) => (openOnly ? s.isOpenNow : true))
    .sort((a, b) => {
      if (a.isOpenNow !== b.isOpenNow) return a.isOpenNow ? -1 : 1;
      return (a.distanceMeters as number) - (b.distanceMeters as number);
    });

  const start = (page - 1) * limit;
  return paginated(withDistance.slice(start, start + limit), withDistance.length, {
    page,
    limit,
  });
}

export async function getPublicShop(shopId: string, lat?: number, lon?: number) {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, status: 'APPROVED' },
    select: publicShopSelect,
  });
  if (!shop) throw notFound('المحل غير موجود أو غير متاح');

  return decorate(shop, lat, lon);
}

/** يتحقق أن المستخدم يملك هذا المحل فعلًا — أساس كل عمليات لوحة المحل */
export async function getOwnedShopOrThrow(userId: string) {
  const shop = await prisma.shop.findUnique({
    where: { ownerId: userId },
    select: {
      id: true,
      name: true,
      description: true,
      imageUrl: true,
      phone: true,
      addressLine: true,
      city: true,
      latitude: true,
      longitude: true,
      status: true,
      isOpen: true,
      openingTime: true,
      closingTime: true,
      deliveryFee: true,
      commissionBps: true,
      ratingAvg: true,
      ratingCount: true,
      categoryId: true,
    },
  });
  if (!shop) throw notFound('لا يوجد محل مرتبط بهذا الحساب');
  return shop;
}

/** المحل المعلّق أو المرفوض لا يستطيع القيام بعمليات تشغيلية */
export function assertShopApproved(status: string) {
  if (status !== 'APPROVED') {
    throw forbidden(
      status === 'PENDING'
        ? 'محلك قيد المراجعة من إدارة المنصة'
        : 'محلك غير مفعّل حاليًا. تواصل مع إدارة المنصة.',
    );
  }
}

export async function updateMyShop(userId: string, data: Record<string, unknown>) {
  const shop = await getOwnedShopOrThrow(userId);
  return prisma.shop.update({
    where: { id: shop.id },
    data,
    select: publicShopSelect,
  });
}

export async function setShopOpen(userId: string, isOpen: boolean) {
  const shop = await getOwnedShopOrThrow(userId);
  assertShopApproved(shop.status);
  return prisma.shop.update({
    where: { id: shop.id },
    data: { isOpen },
    select: { id: true, isOpen: true },
  });
}

export async function getShopStats(shopId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [todayOrders, todaySales, pending, preparing, ready, totalProducts] =
    await Promise.all([
      prisma.order.count({ where: { shopId, createdAt: { gte: startOfDay } } }),
      prisma.order.aggregate({
        where: { shopId, status: 'DELIVERED', deliveredAt: { gte: startOfDay } },
        _sum: { subtotal: true },
      }),
      prisma.order.count({ where: { shopId, status: 'PENDING' } }),
      prisma.order.count({ where: { shopId, status: { in: ['SHOP_ACCEPTED', 'PREPARING'] } } }),
      prisma.order.count({
        where: { shopId, status: { in: ['READY_FOR_PICKUP', 'DRIVER_ASSIGNED'] } },
      }),
      prisma.shopProduct.count({ where: { shopId, isHidden: false } }),
    ]);

  return {
    todayOrders,
    todaySales: todaySales._sum.subtotal ?? 0,
    pendingOrders: pending,
    preparingOrders: preparing,
    readyOrders: ready,
    totalProducts,
  };
}

export type { Pagination };
