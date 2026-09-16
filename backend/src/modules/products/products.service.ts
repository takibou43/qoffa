import { notFound } from '../../lib/errors.js';
import { paginated, type Pagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { ShopProductsQuery } from '../shops/shops.schema.js';
import type { MyProductsQuery } from './products.schema.js';

export const publicProductSelect = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  price: true,
  unit: true,
  isAvailable: true,
  category: { select: { id: true, name: true, slug: true } },
} as const;

export const ownerProductSelect = {
  ...publicProductSelect,
  isHidden: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** منتجات محل كما يراها الزبون — المخفية لا تظهر إطلاقًا */
export async function listPublicShopProducts(shopId: string, query: ShopProductsQuery) {
  const { page, limit, q, categoryId } = query;
  const where = {
    shopId,
    isHidden: false,
    ...(categoryId ? { categoryId } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.shopProduct.findMany({
      where,
      select: publicProductSelect,
      // المتوفر أولًا ثم أبجديًا
      orderBy: [{ isAvailable: 'desc' }, { name: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.shopProduct.count({ where }),
  ]);

  return paginated(items, total, { page, limit });
}

export async function listMyProducts(shopId: string, query: MyProductsQuery) {
  const { page, limit, q, categoryId, availability } = query;

  const availabilityFilter =
    availability === 'available'
      ? { isAvailable: true, isHidden: false }
      : availability === 'unavailable'
        ? { isAvailable: false, isHidden: false }
        : availability === 'hidden'
          ? { isHidden: true }
          : {};

  const where = {
    shopId,
    ...availabilityFilter,
    ...(categoryId ? { categoryId } : {}),
    ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.shopProduct.findMany({
      where,
      select: ownerProductSelect,
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.shopProduct.count({ where }),
  ]);

  return paginated(items, total, { page, limit });
}

/** كل عمليات التعديل تمر عبر هذا التحقق: المنتج يخص هذا المحل */
async function getOwnedProductOrThrow(shopId: string, productId: string) {
  const product = await prisma.shopProduct.findFirst({
    where: { id: productId, shopId },
    select: { id: true },
  });
  if (!product) throw notFound('المنتج غير موجود في محلك');
  return product;
}

export function createProduct(shopId: string, data: Record<string, unknown>) {
  return prisma.shopProduct.create({
    data: { ...data, shopId } as never,
    select: ownerProductSelect,
  });
}

export async function updateProduct(
  shopId: string,
  productId: string,
  data: Record<string, unknown>,
) {
  await getOwnedProductOrThrow(shopId, productId);
  return prisma.shopProduct.update({
    where: { id: productId },
    data,
    select: ownerProductSelect,
  });
}

export async function deleteProduct(shopId: string, productId: string) {
  await getOwnedProductOrThrow(shopId, productId);
  // المنتج قد يكون مرتبطًا بطلبات سابقة؛ العلاقة SetNull تحفظ لقطة الاسم/السعر في OrderItem
  await prisma.shopProduct.delete({ where: { id: productId } });
}

export type { Pagination };
