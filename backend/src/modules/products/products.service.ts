import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { validateImage } from '../../lib/image.js';
import { paginated, type Pagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { newProductImagePath, requireImageStorage, getImageStorage } from '../../lib/storage.js';
import {
  externalLookupEnabled,
  externalSources,
  fetchExternalImage,
  isExternalLookupCandidate,
  type ExternalImage,
  type ExternalProduct,
  type ExternalSource,
  type SourceResult,
} from '../../services/externalCatalog.js';
import type { ShopProductsQuery } from '../shops/shops.schema.js';
import type {
  AddProductInput,
  AdminProductsQuery,
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
  imageSource: true,
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

/* ───────────────── البحث بالباركود (قُفّة أولًا، ثم المصادر الخارجية) ─────────────────
 * الترتيب:
 *   1) قاعدة قُفّة. منتج موجود وله صورة → يُعاد فورًا ولا يُستدعى أي مصدر خارجي.
 *   2) منتج موجود بلا صورة → نبحث عن صورة خارجيًا (مرة كل 7 أيام كحد أقصى) ونضيف الصورة فقط
 *      (لا اسم ولا سعر ولا مخزون ولا أي بيانات محل).
 *   3) باركود غير موجود → Open Food Facts ثم UPCitemdb. إن وُجد: يُنشأ Product مرة واحدة
 *      (UNIQUE(barcode) + INSERT … ON CONFLICT DO NOTHING) مع صورته محفوظة في تخزين قُفّة.
 *   4) لا شيء → إدخال يدوي + رفع صورة.
 * فشل أي مصدر خارجي (timeout، شبكة، حد استعمال) لا يوقف الإضافة أبدًا.
 */

export type LookupSource = 'QOFFA' | ExternalSource | 'MANUAL';

const RECHECK_EXISTING_MS = 7 * 24 * 3600_000;
const MISS_TTL_MS = 30 * 60_000;
const ERROR_TTL_MS = 2 * 60_000;
/** باركودات لم تُعرف خارجيًا مؤخرًا (ذاكرة العملية فقط — لا Redis): تمنع تكرار الاستدعاء عند الضغط المتكرر */
const recentMisses = new Map<string, number>();
/** طلب واحد جارٍ لكل باركود: الطلبات المتزامنة لنفس الباركود تنتظر نفس النتيجة */
const inflight = new Map<string, Promise<unknown>>();

function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing && !lookupTesting.noDedupe) return existing;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const lookupTesting = {
  noDedupe: false,
  reset() {
    recentMisses.clear();
    inflight.clear();
    this.noDedupe = false;
  },
};

interface ExternalSearch {
  product: ExternalProduct | null;
  image: ExternalImage | null;
  /** true = كل المصادر أجابت بوضوح (لا أخطاء مؤقتة) */
  definitive: boolean;
}

/** OFF ثم UPCitemdb. البيانات من أول مصدر يجد المنتج؛ الصورة من أول مصدر تصلح صورته. */
async function searchExternal(barcode: string): Promise<ExternalSearch> {
  let product: ExternalProduct | null = null;
  let image: ExternalImage | null = null;
  let definitive = true;
  for (const source of ['OPEN_FOOD_FACTS', 'UPCITEMDB'] as const) {
    let r: SourceResult;
    try {
      r = await externalSources.lookup(source, barcode);
    } catch (err) {
      r = { kind: 'ERROR', reason: (err as Error).name || 'UNKNOWN' };
    }
    if (r.kind === 'ERROR') {
      definitive = false;
      console.warn(`[barcode] source=${source} barcode=${barcode} error=${r.reason}`);
      continue;
    }
    if (r.kind === 'NOT_FOUND') continue;
    product ??= r.product;
    image = await fetchExternalImage(r.product);
    if (image) break; // لا صورة صالحة هنا → نجرب المصدر التالي للصورة
  }
  return { product, image, definitive };
}

/** يحفظ الصورة الخارجية في تخزين قُفّة (لا يعتمد الزبون على روابط خارجية). فشل التخزين → null. */
async function storeExternalImage(key: string, img: ExternalImage | null) {
  if (!img) return null;
  try {
    const storage = await getImageStorage();
    if (!storage) return null;
    const stored = await storage.put(newProductImagePath(key, img.image.ext), img.bytes, img.image.mime);
    return { storage, stored, source: img.source };
  } catch (err) {
    console.warn('[barcode] image store failed', (err as Error).message);
    return null;
  }
}

/** باركود جديد: إنشاء Product من المصدر الخارجي (مرة واحدة حتى مع طلبات متزامنة) */
async function createFromExternal(barcode: string): Promise<{ source: ExternalSource } | null> {
  const found = await searchExternal(barcode);
  if (!found.product) {
    recentMisses.set(barcode, Date.now() + (found.definitive ? MISS_TTL_MS : ERROR_TTL_MS));
    return null;
  }
  const ext = found.product;
  const saved = await storeExternalImage(`bc-${barcode}`, found.image);
  const res = await prisma.product.createMany({
    data: [
      {
        barcode,
        name: ext.name,
        brand: ext.brand,
        unit: ext.quantity ?? 'قطعة',
        imageUrl: saved?.stored.url ?? null,
        imageSource: saved?.source ?? null,
        externalLookupAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
  if (res.count === 0 && saved) {
    // أنشأه طلب آخر في نفس اللحظة: نكمل صورته إن كانت فارغة، وإلا نحذف ملفنا (لا ملفات يتيمة)
    const upd = await prisma.product.updateMany({
      where: { barcode, imageUrl: null },
      data: { imageUrl: saved.stored.url, imageSource: saved.source },
    });
    if (upd.count === 0) await saved.storage.remove(saved.stored.path).catch(() => undefined);
  }
  return { source: ext.source };
}

/** منتج موجود بلا صورة: نبحث عن صورة فقط، ونضيفها بشرط ذري (لا نكتب فوق صورة أضافها غيرنا) */
async function fillMissingImage(product: { id: string; barcode: string; externalLookupAt: Date | null }) {
  if (product.externalLookupAt && Date.now() - product.externalLookupAt.getTime() < RECHECK_EXISTING_MS) {
    return null;
  }
  const found = await searchExternal(product.barcode);
  const saved = await storeExternalImage(product.id, found.image);
  let added: ExternalSource | null = null;
  if (saved) {
    const upd = await prisma.product.updateMany({
      where: { id: product.id, imageUrl: null },
      data: { imageUrl: saved.stored.url, imageSource: saved.source },
    });
    if (upd.count === 1) added = saved.source;
    else await saved.storage.remove(saved.stored.path).catch(() => undefined);
  }
  // لا نسجّل وقت البحث إن كانت الأخطاء مؤقتة (نعيد المحاولة لاحقًا)
  if (added || found.definitive || found.product) {
    await prisma.product.updateMany({ where: { id: product.id }, data: { externalLookupAt: new Date() } });
  }
  return added;
}

/**
 * مسح باركود من لوحة المحل:
 *  NEW              → غير موجود في قُفّة ولا في المصادر الخارجية (إدخال يدوي + رفع صورة)
 *  AVAILABLE_TO_ADD → المنتج موجود عالميًا ولم يُضف لمحلك (يُدخل سعره وكميته فقط)
 *  ALREADY_LISTED   → موجود في محلك (يعدّل سعره/كميته)
 * lookup.source: QOFFA | OPEN_FOOD_FACTS | UPCITEMDB | MANUAL
 */
export async function lookupBarcode(
  shopId: string,
  code: string,
  opts: { allowExternal?: boolean } = {},
) {
  const canUseExternal =
    (opts.allowExternal ?? true) && externalLookupEnabled() && isExternalLookupCandidate(code);

  let product = await prisma.product.findUnique({
    where: { barcode: code },
    select: { ...globalProductSelect, externalLookupAt: true },
  });
  let source: LookupSource = 'QOFFA';
  let createdFromExternal = false;
  let externalUnavailable = false;

  if (product && !product.imageUrl && canUseExternal) {
    // موجود بلا صورة → صورة فقط من الخارج
    const p = product;
    const added = await dedupe(`img:${code}`, () =>
      fillMissingImage({ id: p.id, barcode: code, externalLookupAt: p.externalLookupAt }),
    );
    if (added) source = added;
  } else if (!product && canUseExternal) {
    const miss = recentMisses.get(code);
    if (!miss || miss < Date.now()) {
      const created = await dedupe(`new:${code}`, () => createFromExternal(code));
      if (created) {
        source = created.source;
        createdFromExternal = true;
      } else {
        externalUnavailable = (recentMisses.get(code) ?? 0) - Date.now() <= ERROR_TTL_MS;
      }
    }
  }

  if (source !== 'QOFFA' || !product) {
    product = await prisma.product.findUnique({
      where: { barcode: code },
      select: { ...globalProductSelect, externalLookupAt: true },
    });
  }

  if (!product) {
    console.info(`[barcode] lookup barcode=${code} source=MANUAL`);
    return {
      status: 'NEW' as const,
      barcode: code,
      lookup: { source: 'MANUAL' as const, externalTried: canUseExternal, externalUnavailable },
    };
  }
  console.info(`[barcode] lookup barcode=${code} source=${source}`);

  const { externalLookupAt: _omit, ...publicProduct } = product;
  void _omit;
  const lookup = { source, createdFromExternal, imageFound: !!product.imageUrl };
  const listing = await prisma.shopProduct.findUnique({
    where: { shopId_productId: { shopId, productId: product.id } },
    select: listingSelect,
  });
  if (listing) {
    return { status: 'ALREADY_LISTED' as const, product: publicProduct, listing: flatten(listing), lookup };
  }
  return { status: 'AVAILABLE_TO_ADD' as const, product: publicProduct, lookup };
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
        // الصورة تُضاف بعد الإنشاء عبر مسار رفع الصورة (ملف يُتحقق منه في الخادم)
        imageUrl: null,
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

/**
 * منتج «خاص» بمحل = بلا باركود ولا يعرضه أي محل آخر → لا يراه غيره، فيحق له تعديل بياناته العالمية.
 * كل منتج بباركود (أو معروض لدى محل آخر) مشترك، وبياناته العالمية للإدارة فقط.
 */
async function isPrivateToShop(shopId: string, productId: string, barcode: string | null) {
  if (barcode !== null) return false;
  const others = await prisma.shopProduct.count({ where: { productId, shopId: { not: shopId } } });
  return others === 0;
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

/** الصورة ليست هنا: لها مسارات مخصّصة بصلاحيات أدق (انظر قسم «صورة المنتج العالمي») */
const GLOBAL_FIELDS = ['name', 'brand', 'description', 'unit', 'categoryId', 'barcode'] as const;

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
    if (!(await isPrivateToShop(shopId, listing.productId, listing.product.barcode))) {
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

/* ───────────────────────── صورة المنتج العالمي ─────────────────────────
 * الصورة مرتبطة بـProduct العالمي (لا بعرض المحل): كل المحلات التي تعرض المنتج تُظهر نفس الصورة.
 * الصلاحيات (كلها في الخادم):
 *   - المحل: يضيف صورة لمنتج في محله **ليست له صورة بعد** (أول صورة فقط، بشرط ذري في قاعدة البيانات).
 *   - المحل: يستبدل/يحذف صورة منتج «خاص» به فقط (بلا باركود ولا يعرضه محل آخر).
 *   - الإدارة: تستبدل أو تحذف صورة أي منتج عالمي.
 * الترتيب الآمن للاستبدال: رفع الجديدة → تحديث الرابط في قاعدة البيانات → حذف القديمة إن لم تعد مستعملة.
 * فشل أي خطوة قبل التحديث لا يمس الصورة الحالية أبدًا.
 */

type ImageMode = 'IF_EMPTY' | 'REPLACE';

/** حذف ملف من التخزين إن كان من تخزيننا ولم يعد أي منتج/محل يستعمل رابطه. لا يُفشل الطلب أبدًا. */
export async function removeStoredImageIfUnused(url: string | null | undefined) {
  if (!url) return;
  try {
    const storage = await getImageStorage();
    const path = storage?.pathFromUrl(url);
    if (!storage || !path) return; // رابط خارجي قديم أو تخزين غير مهيأ: لا نحذف شيئًا
    const [products, shops] = await Promise.all([
      prisma.product.count({ where: { imageUrl: url } }),
      prisma.shop.count({ where: { imageUrl: url } }),
    ]);
    if (products + shops > 0) return;
    await storage.remove(path);
  } catch (err) {
    console.error('[storage] cleanup failed', (err as Error).message);
  }
}

async function attachImage(
  productId: string,
  body: unknown,
  contentType: string | undefined,
  mode: ImageMode,
  source: 'SHOP_UPLOAD' | 'ADMIN_UPLOAD',
) {
  // 1) التحقق من الملف قبل أي رفع
  const image = validateImage(body, contentType);
  const current = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, imageUrl: true },
  });
  if (!current) throw notFound('المنتج غير موجود');
  if (mode === 'IF_EMPTY' && current.imageUrl) throw imageAlreadySet();

  // 2) رفع الملف الجديد (مسار فريد؛ لا يكتب فوق أي ملف)
  const storage = await requireImageStorage();
  const stored = await storage.put(
    newProductImagePath(productId, image.ext),
    body as Buffer,
    image.mime,
  );

  // 3) تحديث ذري مشروط: ينجح فقط إن لم تتغير الصورة منذ قراءتها (يمنع سباق محلين/مديرين)
  let updated = 0;
  try {
    const res = await prisma.product.updateMany({
      where: { id: productId, imageUrl: current.imageUrl },
      data: { imageUrl: stored.url, imageSource: source },
    });
    updated = res.count;
  } catch (err) {
    await storage.remove(stored.path).catch(() => undefined);
    throw err;
  }
  if (updated === 0) {
    // تغيّرت الصورة في الأثناء: نتراجع عن الرفع ولا نكتب فوق صورة غيرنا
    await storage.remove(stored.path).catch(() => undefined);
    throw mode === 'IF_EMPTY'
      ? imageAlreadySet()
      : conflict('تغيّرت صورة المنتج أثناء الرفع. أعد تحميل الصفحة ثم حاول مجددًا.');
  }

  // 4) بعد نجاح التحديث فقط: حذف الصورة القديمة إن لم تعد مستعملة
  if (current.imageUrl && current.imageUrl !== stored.url) {
    await removeStoredImageIfUnused(current.imageUrl);
  }

  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: globalProductSelect,
  });
  return { product, previousImageUrl: current.imageUrl, image };
}

async function detachImage(productId: string) {
  const current = await prisma.product.findUnique({
    where: { id: productId },
    select: { imageUrl: true },
  });
  if (!current) throw notFound('المنتج غير موجود');
  if (current.imageUrl) {
    // يُزال الرابط فقط — المنتج وعروض المحلات والطلبات لا تُمس
    await prisma.product.updateMany({
      where: { id: productId, imageUrl: current.imageUrl },
      data: { imageUrl: null, imageSource: null },
    });
    await removeStoredImageIfUnused(current.imageUrl);
  }
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: globalProductSelect,
  });
  return { product, previousImageUrl: current.imageUrl };
}

const imageAlreadySet = () =>
  conflict(
    'لهذا المنتج صورة بالفعل وتظهر عند كل المحلات. تغييرها من صلاحية إدارة المنصة.',
    { reason: 'IMAGE_ALREADY_SET' },
  );

/** المحل يرفع صورة لمنتج في محله: أول صورة لأي منتج، أو استبدال لمنتج خاص به فقط */
export async function shopSetProductImage(
  shopId: string,
  listingId: string,
  body: unknown,
  contentType: string | undefined,
) {
  const listing = await getOwnedListingOrThrow(shopId, listingId);
  let mode: ImageMode = 'IF_EMPTY';
  if (listing.product.imageUrl) {
    if (!(await isPrivateToShop(shopId, listing.productId, listing.product.barcode))) {
      throw forbidden(
        'لهذا المنتج صورة بالفعل وتظهر عند كل المحلات، فلا يغيّرها المحل. تواصل مع إدارة المنصة لتغييرها.',
      );
    }
    mode = 'REPLACE';
  }
  const { product } = await attachImage(listing.productId, body, contentType, mode, 'SHOP_UPLOAD');
  return product;
}

/** المحل يحذف صورة منتج خاص به فقط */
export async function shopRemoveProductImage(shopId: string, listingId: string) {
  const listing = await getOwnedListingOrThrow(shopId, listingId);
  if (!(await isPrivateToShop(shopId, listing.productId, listing.product.barcode))) {
    throw forbidden('صورة المنتج العالمي لا يحذفها المحل لأنها تظهر عند كل المحلات. تواصل مع إدارة المنصة.');
  }
  const { product } = await detachImage(listing.productId);
  return product;
}

/** الإدارة: استبدال/إضافة صورة أي منتج عالمي */
export async function adminSetProductImage(
  productId: string,
  body: unknown,
  contentType: string | undefined,
) {
  return attachImage(productId, body, contentType, 'REPLACE', 'ADMIN_UPLOAD');
}

/** الإدارة: حذف صورة منتج عالمي (المنتج نفسه يبقى) */
export async function adminRemoveProductImage(productId: string) {
  return detachImage(productId);
}

/** الإدارة: قائمة المنتجات العالمية مع عدد المحلات التي تعرض كل منتج */
export async function adminListProducts(query: AdminProductsQuery) {
  const { page, limit, q, image } = query;
  const where = {
    AND: [
      ...(image === 'with' ? [{ imageUrl: { not: null } }] : []),
      ...(image === 'without' ? [{ imageUrl: null }] : []),
      ...(q
        ? [
            {
              OR: [
                { name: { contains: q, mode: 'insensitive' as const } },
                { brand: { contains: q, mode: 'insensitive' as const } },
                { barcode: q },
              ],
            },
          ]
        : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: { ...globalProductSelect, updatedAt: true, _count: { select: { listings: true } } },
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);
  return paginated(
    items.map(({ _count, ...p }) => ({ ...p, shopsCount: _count.listings })),
    total,
    { page, limit },
  );
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
