import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { paginated, type Pagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { ShopProductsQuery } from '../shops/shops.schema.js';
import type {
  AddProductInput,
  MyProductsQuery,
  UpdateListingInput,
} from './products.schema.js';

/**
 * نموذج المنتجات:
 *   Product      = المنتج العالمي (باركود فريد عالميًا، اسم، علامة، وحدة، صورة، تصنيف) — بلا سعر.
 *   ShopProduct  = عرض المنتج داخل محل (سعر، كمية، توفر) — خاص بكل محل، وهو ما تستعمله السلة والطلبات.
 * واجهات الـAPI تُعيد «عرضًا مسطّحًا»: id = معرّف ShopProduct، productId = معرّف المنتج العالمي.
 */

const globalProductSelect = {
  id: true,
  barcode: true,
  name: true,
  brand: true,
  description: true,
  imageUrl: true,
  unit: true,
  categoryId: true,
  category: { select: { id: true, name: true, slug: true } },
} as const;

const listingSelect = {
  id: true,
  productId: true,
  price: true,
  stock: true,
  isAvailable: true,
  isHidden: true,
  createdAt: true,
  updatedAt: true,
  product: { select: globalProductSelect },
} as const;

type ListingRow = {
  id: string;
  productId: string;
  price: number;
  stock: number | null;
  isAvailable: boolean;
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;
  product: {
    id: string;
    barcode: string | null;
    name: string;
    brand: string | null;
    description: string | null;
    imageUrl: string | null;
    unit: string;
    categoryId: string | null;
    category: { id: string; name: string; slug: string } | null;
  };
};

/** يدمج بيانات المنتج العالمي مع بيانات عرض المحل (id يبقى معرّف عرض المحل) */
function flatten(l: ListingRow) {
  return {
    id: l.id,
    productId: l.productId,
    barcode: l.product.barcode,
    name: l.product.name,
    brand: l.product.brand,
    description: l.product.description,
    imageUrl: l.product.imageUrl,
    unit: l.product.unit,
    categoryId: l.product.categoryId,
    category: l.product.category,
    price: l.price,
    stock: l.stock,
    isAvailable: l.isAvailable,
    isHidden: l.isHidden,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

/** ما يراه الزبون: بلا الكمية الدقيقة ولا حالة الإخفاء */
function toPublic(l: ListingRow) {
  const f = flatten(l);
  return {
    id: f.id,
    productId: f.productId,
    barcode: f.barcode,
    name: f.name,
    brand: f.brand,
    description: f.description,
    imageUrl: f.imageUrl,
    unit: f.unit,
    price: f.price,
    // الكمية المتتبَّعة إن نفدت فالمنتج غير متوفر للزبون
    isAvailable: f.isAvailable && (f.stock === null || f.stock > 0),
    category: f.category,
  };
}

const textFilter = (q: string) => ({
  product: {
    OR: [
      { name: { contains: q, mode: 'insensitive' as const } },
      { brand: { contains: q, mode: 'insensitive' as const } },
      { barcode: q },
    ],
  },
});

/* ───────────────────────── الزبون ───────────────────────── */

/** منتجات محل كما يراها الزبون — المخفية لا تظهر، والسعر هو سعر هذا المحل */
export async function listPublicShopProducts(shopId: string, query: ShopProductsQuery) {
  const { page, limit, q, categoryId } = query;
  const where = {
    AND: [
      { shopId, isHidden: false },
      ...(categoryId ? [{ product: { categoryId } }] : []),
      ...(q ? [textFilter(q)] : []),
    ],
  };

  const [items, total] = await Promise.all([
    prisma.shopProduct.findMany({
      where,
      select: listingSelect,
      orderBy: [{ isAvailable: 'desc' }, { product: { name: 'asc' } }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.shopProduct.count({ where }),
  ]);

  return paginated(items.map(toPublic), total, { page, limit });
}

/** نفس المنتج العالمي عبر المحلات: سعر كل محل وتوفره (للمقارنة بين المحلات) */
export async function getCatalogByBarcode(code: string) {
  const product = await prisma.product.findUnique({
    where: { barcode: code },
    select: globalProductSelect,
  });
  if (!product) throw notFound('لا يوجد منتج بهذا الباركود');

  const listings = await prisma.shopProduct.findMany({
    where: { productId: product.id, isHidden: false, shop: { status: 'APPROVED' } },
    select: {
      id: true,
      price: true,
      stock: true,
      isAvailable: true,
      shop: { select: { id: true, name: true, city: true, isOpen: true, latitude: true, longitude: true } },
    },
    orderBy: [{ price: 'asc' }],
  });

  return {
    product,
    shops: listings.map((l) => ({
      listingId: l.id,
      price: l.price,
      isAvailable: l.isAvailable && (l.stock === null || l.stock > 0),
      shop: l.shop,
    })),
  };
}

/* ───────────────────────── المحل ───────────────────────── */

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
    AND: [
      { shopId, ...availabilityFilter },
      ...(categoryId ? [{ product: { categoryId } }] : []),
      ...(q ? [textFilter(q)] : []),
    ],
  };

  const [items, total] = await Promise.all([
    prisma.shopProduct.findMany({
      where,
      select: listingSelect,
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.shopProduct.count({ where }),
  ]);

  return paginated(items.map(flatten), total, { page, limit });
}

/**
 * مسح باركود من لوحة المحل:
 *  NEW              → منتج جديد كليًا (يُدخل المحل بياناته العالمية + سعره)
 *  AVAILABLE_TO_ADD → المنتج موجود عالميًا ولم يُضف لمحلك (يُدخل سعره وكميته فقط)
 *  ALREADY_LISTED   → موجود في محلك (يعدّل سعره/كميته)
 */
export async function lookupBarcode(shopId: string, code: string) {
  const product = await prisma.product.findUnique({
    where: { barcode: code },
    select: globalProductSelect,
  });
  if (!product) return { status: 'NEW' as const, barcode: code };

  const listing = await prisma.shopProduct.findUnique({
    where: { shopId_productId: { shopId, productId: product.id } },
    select: listingSelect,
  });
  if (listing) {
    return { status: 'ALREADY_LISTED' as const, product, listing: flatten(listing) };
  }
  return { status: 'AVAILABLE_TO_ADD' as const, product };
}

/**
 * إضافة منتج إلى محل.
 * الباركود معرّف عالمي: إن وُجد منتج بنفس الباركود يُعاد استعماله ولا يُنشأ منتج ثانٍ أبدًا،
 * وتُتجاهل أي بيانات عالمية يرسلها المحل (الاسم/العلامة/...) حتى لا يغيّر منتجًا يراه الجميع.
 * الحماية النهائية من التكرار في قاعدة البيانات نفسها:
 *   UNIQUE(Product.barcode) و UNIQUE(ShopProduct.shopId, productId)
 * وبدل findFirst→create (سباق) نستعمل INSERT … ON CONFLICT DO NOTHING داخل معاملة.
 */
export async function addProductToShop(shopId: string, input: AddProductInput) {
  const barcode = input.barcode ?? null;

  return prisma.$transaction(async (tx) => {
    let productId: string;
    let createdGlobal = false;

    const existing = barcode
      ? await tx.product.findUnique({ where: { barcode }, select: { id: true } })
      : null;

    if (existing) {
      productId = existing.id;
    } else {
      if (!input.name) {
        throw badRequest('منتج جديد: اسم المنتج مطلوب', {
          fields: [{ field: 'name', message: 'اسم المنتج مطلوب لمنتج جديد' }],
        });
      }
      const data = {
        barcode,
        name: input.name,
        brand: input.brand ?? null,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        unit: input.unit ?? 'قطعة',
        categoryId: input.categoryId ?? null,
      };

      if (barcode) {
        // طلبان متزامنان بنفس الباركود: أحدهما فقط ينشئ، والآخر ينتظر ثم يقرأ الصف المُنشأ
        const res = await tx.product.createMany({ data: [data], skipDuplicates: true });
        createdGlobal = res.count === 1;
        const p = await tx.product.findUniqueOrThrow({ where: { barcode }, select: { id: true } });
        productId = p.id;
      } else {
        const p = await tx.product.create({ data, select: { id: true } });
        createdGlobal = true;
        productId = p.id;
      }
    }

    const res = await tx.shopProduct.createMany({
      data: [
        {
          shopId,
          productId,
          price: input.price,
          stock: input.stock ?? null,
          isAvailable: input.isAvailable,
          isHidden: input.isHidden,
        },
      ],
      skipDuplicates: true,
    });

    if (res.count === 0) {
      const mine = await tx.shopProduct.findUnique({
        where: { shopId_productId: { shopId, productId } },
        select: { id: true },
      });
      throw conflict('هذا المنتج موجود في محلك بالفعل — عدّل سعره أو كميته بدل إضافته من جديد', {
        listingId: mine?.id,
      });
    }

    const listing = await tx.shopProduct.findUniqueOrThrow({
      where: { shopId_productId: { shopId, productId } },
      select: listingSelect,
    });
    return { product: flatten(listing), createdGlobalProduct: createdGlobal };
  });
}

/** كل عمليات التعديل تمر عبر هذا التحقق: العرض يخص هذا المحل */
async function getOwnedListingOrThrow(shopId: string, listingId: string) {
  const listing = await prisma.shopProduct.findFirst({
    where: { id: listingId, shopId },
    select: {
      id: true,
      productId: true,
      product: { select: { id: true, barcode: true, name: true, brand: true, description: true, imageUrl: true, unit: true, categoryId: true } },
    },
  });
  if (!listing) throw notFound('المنتج غير موجود في محلك');
  return listing;
}

const GLOBAL_FIELDS = ['name', 'brand', 'description', 'imageUrl', 'unit', 'categoryId', 'barcode'] as const;

/**
 * تعديل عرض المنتج في المحل.
 * السعر/الكمية/التوفر/الإخفاء خاصة بالمحل وحده (لا تمس المحلات الأخرى ولا المنتج العالمي).
 * البيانات العالمية لا يغيّرها المحل إلا لمنتج بلا باركود يخصّه وحده (لا يراه محل آخر)؛
 * وما عدا ذلك يعدّله مدير المنصة فقط.
 */
export async function updateListing(shopId: string, listingId: string, input: UpdateListingInput) {
  const listing = await getOwnedListingOrThrow(shopId, listingId);

  const globalChanges: Record<string, unknown> = {};
  for (const key of GLOBAL_FIELDS) {
    const next = (input as Record<string, unknown>)[key];
    if (next === undefined) continue;
    if (next !== (listing.product as Record<string, unknown>)[key]) globalChanges[key] = next;
  }

  if (Object.keys(globalChanges).length > 0) {
    const sharedWithOthers =
      (await prisma.shopProduct.count({
        where: { productId: listing.productId, shopId: { not: shopId } },
      })) > 0;
    const privateProduct = listing.product.barcode === null && !sharedWithOthers;
    if (!privateProduct) {
      throw forbidden(
        'بيانات المنتج العالمي (الاسم، العلامة، الباركود، الصورة…) لا يعدّلها المحل لأنها تظهر عند كل المحلات. تواصل مع إدارة المنصة.',
      );
    }
    if (typeof globalChanges.barcode === 'string') {
      const clash = await prisma.product.findUnique({
        where: { barcode: globalChanges.barcode },
        select: { id: true },
      });
      if (clash) {
        throw conflict('هذا الباركود لمنتج موجود في المنصة — أضف ذلك المنتج إلى محلك بدل ربط الباركود بهذا المنتج');
      }
    }
  }

  const shopData = {
    ...(input.price !== undefined ? { price: input.price } : {}),
    ...(input.stock !== undefined ? { stock: input.stock } : {}),
    ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
    ...(input.isHidden !== undefined ? { isHidden: input.isHidden } : {}),
  };

  const updated = await prisma.$transaction(async (tx) => {
    if (Object.keys(globalChanges).length > 0) {
      await tx.product.update({ where: { id: listing.productId }, data: globalChanges });
    }
    return tx.shopProduct.update({
      where: { id: listingId },
      data: shopData,
      select: listingSelect,
    });
  });
  return flatten(updated);
}

/** حذف عرض المحل فقط — المنتج العالمي يبقى (قد تعرضه محلات أخرى، والطلبات القديمة تحتفظ بلقطتها) */
export async function deleteListing(shopId: string, listingId: string) {
  await getOwnedListingOrThrow(shopId, listingId);
  await prisma.shopProduct.delete({ where: { id: listingId } });
}

/* ───────────────────────── الإدارة ───────────────────────── */

/** تعديل بيانات المنتج العالمي (مدير المنصة فقط — يؤثر على كل المحلات) */
export async function adminUpdateGlobalProduct(
  productId: string,
  data: Record<string, unknown>,
) {
  const current = await prisma.product.findUnique({ where: { id: productId } });
  if (!current) throw notFound('المنتج غير موجود');
  if (typeof data.barcode === 'string' && data.barcode !== current.barcode) {
    const clash = await prisma.product.findUnique({
      where: { barcode: data.barcode },
      select: { id: true, name: true },
    });
    if (clash) throw conflict(`هذا الباركود مستعمل للمنتج «${clash.name}»`, { productId: clash.id });
  }
  const updated = await prisma.product.update({
    where: { id: productId },
    data,
    select: globalProductSelect,
  });
  return { before: current, after: updated };
}

export { flatten as flattenListing, listingSelect };
export type { Pagination };
