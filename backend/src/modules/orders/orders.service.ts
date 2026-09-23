import { generateOrderCode } from '../../lib/code.js';
import { timingSafeEqual } from 'node:crypto';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { haversineMeters } from '../../lib/geo.js';
import { computeIsOpenNow } from '../../lib/hours.js';
import { paginated, type Pagination } from '../../lib/pagination.js';
import { prisma, type Prisma } from '../../lib/prisma.js';
import type { ActorType, OrderStatus } from '../../generated/prisma/enums.js';
import { STATUS_NOTIFICATION, notifyMany } from '../../services/notifications.js';
import {
  STATUS_TIMESTAMP,
  assertTransition,
  isTerminal,
} from '../../services/orderStateMachine.js';
import {
  computeDeliveryFee,
  loadPricingConfig,
  platformFeeFor,
  type DeliveryQuote,
} from '../../services/deliveryPricing.js';
import { buildQrPayload, parseQrPayload, qrVisible } from '../../services/orderQr.js';
import { orderSettlement, toShopOrderView } from '../../services/orderMoney.js';
import { releaseStock, reserveStock, shouldRestock } from '../../services/stock.js';
import { settleDeliveredOrder } from '../../services/wallet.js';
import type { CreateOrderInput, ListOrdersQuery } from './orders.schema.js';

/* ───────────────────────────── إنشاء الطلب ───────────────────────────── */

export const orderItemSelect = {
  id: true,
  productId: true,
  nameSnapshot: true,
  unitSnapshot: true,
  unitPrice: true,
  quantity: true,
  lineTotal: true,
  // صورة المنتج العالمي الحالية للعرض فقط؛ لقطة الطلب (الاسم/السعر) لا تتأثر بتغيير الصورة أو حذفها
  product: { select: { product: { select: { imageUrl: true } } } },
} as const;

/** ما يراه الزبون */
export const customerOrderSelect = {
  id: true,
  code: true,
  status: true,
  subtotal: true,
  deliveryFee: true,
  total: true,
  paymentMethod: true,
  customerNote: true,
  deliveryAddressLine: true,
  deliveryCity: true,
  deliveryLatitude: true,
  deliveryLongitude: true,
  distanceMeters: true,
  rejectionReason: true,
  cancelReason: true,
  cancelledBy: true,
  createdAt: true,
  acceptedAt: true,
  preparingAt: true,
  readyAt: true,
  assignedAt: true,
  pickedUpAt: true,
  outForDeliveryAt: true,
  deliveredAt: true,
  pickupVerifiedAt: true,
  deliveryVerifiedAt: true,
  items: { select: orderItemSelect },
  shop: {
    select: {
      id: true,
      name: true,
      phone: true,
      imageUrl: true,
      addressLine: true,
      latitude: true,
      longitude: true,
    },
  },
  driver: {
    select: {
      id: true,
      vehicleType: true,
      ratingAvg: true,
      user: { select: { fullName: true, phone: true } },
    },
  },
  reviews: { select: { id: true, targetType: true, rating: true } },
} as const;

/** ما يراه المحل — يشمل بيانات الزبون للتواصل */
export const shopOrderSelect = {
  ...customerOrderSelect,
  customerPhone: true,
  customer: { select: { id: true, fullName: true, phone: true } },
} as const;

/** سعر التوصيل التقديري قبل تأكيد الطلب — نفس الحساب المستعمل عند الإنشاء */
export async function quoteDelivery(
  shopId: string,
  lat: number,
  lon: number,
): Promise<DeliveryQuote & { maxKm: number }> {
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, status: 'APPROVED' },
    select: { latitude: true, longitude: true },
  });
  if (!shop) throw notFound('المحل غير متاح');
  const pricing = await loadPricingConfig();
  const quote = computeDeliveryFee(
    pricing,
    haversineMeters(shop.latitude, shop.longitude, lat, lon),
  );
  return { ...quote, maxKm: pricing.maxKm };
}

/** طلب سابق بنفس مفتاح منع التكرار (إعادة إرسال/retry) */
async function findByClientRequestId(customerId: string, clientRequestId?: string) {
  if (!clientRequestId) return null;
  return prisma.order.findUnique({
    where: { customerId_clientRequestId: { customerId, clientRequestId } },
    select: customerOrderSelect,
  });
}

/** محاولات توليد رقم طلب فريد عند التصادم (احتمال التصادم ضئيل جدًا: 34^6 تركيبة) */
const ORDER_CODE_ATTEMPTS = 5;

export async function createOrder(customerId: string, input: CreateOrderInput) {
  // إعادة إرسال نفس الطلب: نعيد الطلب الموجود دون إنشاء جديد ودون خصم ثانٍ للمخزون
  const existing = await findByClientRequestId(customerId, input.clientRequestId);
  if (existing) return existing;

  const shop = await prisma.shop.findUnique({
    where: { id: input.shopId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      status: true,
      isOpen: true,
      openingTime: true,
      closingTime: true,
      latitude: true,
      longitude: true,
    },
  });
  if (!shop || shop.status !== 'APPROVED') throw notFound('المحل غير متاح');
  if (!computeIsOpenNow(shop)) throw conflict('المحل مغلق حاليًا');

  // عنوان التسليم: محفوظ (بملكية مؤكدة) أو يدوي
  let addressId: string | null = null;
  let delivery: { addressLine: string; city: string; latitude: number; longitude: number };

  if (input.addressId) {
    const saved = await prisma.address.findFirst({
      where: { id: input.addressId, userId: customerId },
      select: { id: true, addressLine: true, city: true, latitude: true, longitude: true },
    });
    if (!saved) throw notFound('العنوان غير موجود');
    addressId = saved.id;
    delivery = saved;
  } else {
    delivery = input.address!;
  }

  // الأسعار تُقرأ من قاعدة البيانات دائمًا — لا نثق بما يرسله العميل
  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const products = await prisma.shopProduct.findMany({
    where: { id: { in: productIds }, shopId: shop.id, isHidden: false },
    select: {
      id: true,
      price: true,
      stock: true,
      isAvailable: true,
      product: { select: { name: true, unit: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const missing = productIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw badRequest('بعض المنتجات غير موجودة في هذا المحل', { productIds: missing });
  }
  // دمج الكميات المكررة لنفس المنتج
  const quantities = new Map<string, number>();
  for (const item of input.items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }

  // التوفر خاص بعرض هذا المحل (ShopProduct)
  const unavailable = products.filter((p) => !p.isAvailable).map((p) => p.product.name);
  if (unavailable.length > 0) {
    throw conflict('بعض المنتجات غير متوفرة حاليًا', { products: unavailable });
  }
  // فحص مبدئي سريع للكمية؛ الفحص الحاسم هو الخصم الذري داخل المعاملة (reserveStock)
  const shortage = products.find(
    (p) => p.stock !== null && p.stock < (quantities.get(p.id) ?? 0),
  );
  if (shortage) {
    const available = Math.max(0, shortage.stock ?? 0);
    throw conflict(
      available === 0
        ? `نفدت كمية «${shortage.product.name}» من المخزون`
        : `الكمية المطلوبة من «${shortage.product.name}» غير متوفرة. المتوفر حاليًا: ${available}`,
      {
        products: products
          .filter((p) => p.stock !== null && p.stock < (quantities.get(p.id) ?? 0))
          .map((p) => p.product.name),
      },
    );
  }

  const items = [...quantities.entries()].map(([productId, quantity]) => {
    const p = byId.get(productId)!;
    return {
      productId,
      nameSnapshot: p.product.name,
      unitSnapshot: p.product.unit,
      unitPrice: p.price,
      quantity,
      lineTotal: p.price * quantity,
    };
  });

  const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);

  // رسم التوصيل تحدده الإدارة وتحسبه الخادم حسب المسافة من المحل إلى الزبون
  const distanceMeters = haversineMeters(
    shop.latitude,
    shop.longitude,
    delivery.latitude,
    delivery.longitude,
  );
  const pricing = await loadPricingConfig();
  const quote = computeDeliveryFee(pricing, distanceMeters);
  if (!quote.withinRange) {
    throw conflict(`عنوانك خارج نطاق التوصيل (الحد الأقصى ${pricing.maxKm} كم)`, {
      distanceKm: quote.distanceKm,
      maxKm: pricing.maxKm,
    });
  }
  const deliveryFee = quote.fee;
  // حصة قفة تُثبَّت الآن في الطلب؛ تغييرها لاحقًا من الإدارة لا يمسّ هذا الطلب
  const platformFee = platformFeeFor(pricing, deliveryFee);
  const customer = await prisma.user.findUniqueOrThrow({
    where: { id: customerId },
    select: { phone: true },
  });

  const createOrderTx = async (tx: Prisma.TransactionClient) => {
    // الخصم الذري للمخزون أولًا: إن نقصت أي كمية تُرجَع المعاملة كلها ولا يُنشأ الطلب
    const reserved = await reserveStock(
      tx,
      items.map((i) => ({ shopProductId: i.productId, quantity: i.quantity, name: i.nameSnapshot })),
    );
    const itemsWithReservation = items.map((i) => ({
      ...i,
      reservedQty: reserved.get(i.productId) ?? 0,
    }));

    // داخل المعاملة نُنشئ بأقل قدر من الحقول؛ القراءة الكاملة بعلاقاتها تتم بعد الالتزام
    const created = await tx.order.create({
      data: {
        clientRequestId: input.clientRequestId ?? null,
        stockReserved: itemsWithReservation.some((i) => i.reservedQty > 0),
        code: generateOrderCode(),
        customerId,
        shopId: shop.id,
        status: 'PENDING',
        subtotal,
        deliveryFee,
        platformFee,
        total: subtotal + deliveryFee,
        paymentMethod: input.paymentMethod,
        customerNote: input.customerNote ?? null,
        addressId,
        deliveryAddressLine: delivery.addressLine,
        deliveryCity: delivery.city,
        deliveryLatitude: delivery.latitude,
        deliveryLongitude: delivery.longitude,
        customerPhone: customer.phone,
        distanceMeters,
        items: { createMany: { data: itemsWithReservation } },
      },
      select: { id: true, code: true, subtotal: true },
    });

    await tx.orderStatusEvent.create({
      data: {
        orderId: created.id,
        fromStatus: null,
        toStatus: 'PENDING',
        actorType: 'CUSTOMER',
        actorId: customerId,
      },
    });

    await notifyMany(tx, [
      {
        userId: shop.ownerId,
        type: 'ORDER_CREATED',
        title: 'طلب جديد',
        // المحل يرى قيمة المنتجات فقط — لا رسوم توصيل ولا إجمالي
        body: `وصلك طلب جديد ${created.code} بقيمة منتجات ${created.subtotal} دج.`,
        orderId: created.id,
      },
      {
        userId: customerId,
        type: 'ORDER_CREATED',
        title: 'تم إرسال طلبك',
        body: `طلبك ${created.code} في انتظار موافقة ${shop.name}.`,
        orderId: created.id,
      },
    ]);

    return created.id;
  };

  let orderId: string | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      orderId = await prisma.$transaction(createOrderTx);
      break;
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      // إرسالان متزامنان بنفس المفتاح: الثاني يصطدم بالقيد الفريد وتُرجَع معاملته (بما فيها الخصم)
      if (input.clientRequestId) {
        const winner = await findByClientRequestId(customerId, input.clientRequestId);
        if (winner) return winner;
      }
      // غير ذلك: تصادم نادر في رقم الطلب القصير — تُرجَع المعاملة كاملة ونعيد بتوليد رقم جديد
      if (attempt >= ORDER_CODE_ATTEMPTS) throw err;
    }
  }

  return prisma.order.findUniqueOrThrow({
    where: { id: orderId! },
    select: customerOrderSelect,
  });
}

/* ───────────────────────────── الانتقالات ───────────────────────────── */

export interface TransitionOptions {
  actorType: ActorType;
  actorId?: string | null;
  note?: string;
  /** سبب الرفض/الإلغاء */
  reason?: string;
  /** تعيين موصّل مع الانتقال إلى DRIVER_ASSIGNED */
  driverId?: string;
  /** عميل معاملة موجود (تُستعمل عند الاستدعاء من داخل معاملة أخرى) */
  tx?: Prisma.TransactionClient;
  /** لا تُرسل إشعارات القالب الافتراضي (المستدعي يرسل إشعارًا مخصّصًا) */
  silent?: boolean;
}

type OrderForTransition = {
  id: string;
  code: string;
  status: OrderStatus;
  customerId: string;
  shopId: string;
  driverId: string | null;
  subtotal: number;
  deliveryFee: number;
  platformFee: number;
  shop: { ownerId: string; commissionBps: number };
  driver: { userId: string } | null;
};

async function runTransition(
  tx: Prisma.TransactionClient,
  orderId: string,
  to: OrderStatus,
  options: TransitionOptions,
) {
  const order = (await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      status: true,
      customerId: true,
      shopId: true,
      driverId: true,
      subtotal: true,
      deliveryFee: true,
      platformFee: true,
      shop: { select: { ownerId: true, commissionBps: true } },
      driver: { select: { userId: true } },
    },
  })) as OrderForTransition | null;

  if (!order) throw notFound('الطلب غير موجود');

  assertTransition(order.status, to, options.actorType);

  const now = new Date();
  const data: Record<string, unknown> = { status: to };

  const timestampField = STATUS_TIMESTAMP[to];
  if (timestampField) data[timestampField] = now;
  if (isTerminal(to)) data.closedAt = now;

  if (to === 'REJECTED') data.rejectionReason = options.reason ?? null;
  if (to === 'CANCELLED') {
    data.cancelReason = options.reason ?? null;
    data.cancelledBy = options.actorType;
  }
  if (to === 'DRIVER_ASSIGNED' && options.driverId) data.driverId = options.driverId;
  if (to === 'READY_FOR_PICKUP' && order.status === 'DRIVER_ASSIGNED') {
    // الموصّل انسحب — نُفرغ التعيين ليعاد البحث
    data.driverId = null;
  }

  /**
   * القفل التفاؤلي: التحديث مشروط ببقاء الحالة كما قرأناها.
   * إن سبقنا طلب آخر (سباق) سيعيد count = 0 ونرفض العملية بدل الكتابة فوقها.
   */
  const guard: Record<string, unknown> = { id: orderId, status: order.status };
  // شرط إضافي: لا يُعيَّن موصّل لطلب لديه موصّل بالفعل (حماية من السباق)
  if (to === 'DRIVER_ASSIGNED') guard.driverId = null;

  const updated = await tx.order.updateMany({
    where: guard as never,
    data: data as never,
  });
  if (updated.count === 0) {
    throw conflict('تغيّرت حالة الطلب أثناء التنفيذ. أعد المحاولة.');
  }

  await tx.orderStatusEvent.create({
    data: {
      orderId,
      fromStatus: order.status,
      toStatus: to,
      actorType: options.actorType,
      actorId: options.actorId ?? null,
      note: options.note ?? options.reason ?? null,
    },
  });

  // ── الآثار الجانبية ──
  // الرفض/الإلغاء قبل خروج البضاعة من المحل يعيد الكمية المحجوزة (مرة واحدة فقط)
  if (shouldRestock(order.status, to)) {
    await releaseStock(tx, orderId);
  }

  const driverIdNow = (data.driverId as string | undefined) ?? order.driverId;

  if (to === 'PICKED_UP' && driverIdNow) {
    await tx.delivery.updateMany({
      where: { orderId },
      data: { pickedUpAt: now },
    });
  }

  if (to === 'DELIVERED') {
    const { commission, driverEarning } = await settleDeliveredOrder(
      tx,
      {
        id: order.id,
        code: order.code,
        shopId: order.shopId,
        driverId: driverIdNow,
        subtotal: order.subtotal,
        deliveryFee: order.deliveryFee,
        platformFee: order.platformFee,
      },
      { commissionBps: order.shop.commissionBps },
    );
    await tx.order.update({
      where: { id: orderId },
      data: { commissionAmount: commission, driverEarning },
    });
    await tx.delivery.updateMany({
      where: { orderId },
      data: { deliveredAt: now, earning: driverEarning },
    });
  }

  if (to === 'FAILED_DELIVERY') {
    await tx.delivery.updateMany({
      where: { orderId },
      data: { failedAt: now, failReason: options.reason ?? null },
    });
  }

  // تحرير الموصّل عند أي حالة نهائية أو عند سحب التعيين
  const releasesDriver =
    isTerminal(to) || to === 'FAILED_DELIVERY' || (to === 'READY_FOR_PICKUP' && order.driverId);
  if (releasesDriver && order.driverId) {
    await tx.driverProfile.updateMany({
      where: { id: order.driverId, currentOrderId: orderId },
      data: { currentOrderId: null },
    });
  }

  // إلغاء كل عروض التوصيل المعلّقة عندما لم يعد الطلب قابلًا للالتقاط
  if (isTerminal(to) || to === 'DRIVER_ASSIGNED') {
    await tx.deliveryOffer.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: now },
    });
  }

  // ── الإشعارات ──
  const template = options.silent ? undefined : STATUS_NOTIFICATION[to];
  if (template) {
    const recipients = new Set<string>([order.customerId]);
    // المحل يُعلَم بما يخص التوصيل والإلغاء
    if (['DRIVER_ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CANCELLED', 'NO_DRIVER'].includes(to)) {
      recipients.add(order.shop.ownerId);
    }
    if (order.driver && ['CANCELLED', 'FAILED_DELIVERY'].includes(to)) {
      recipients.add(order.driver.userId);
    }
    await notifyMany(
      tx,
      [...recipients].map((userId) => ({
        userId,
        type: template.type,
        title: template.title,
        body: template.body(order.code),
        orderId,
      })),
    );
  }

  return { from: order.status, to };
}

/** نقطة الدخول الوحيدة لتغيير حالة أي طلب */
export async function transitionOrder(
  orderId: string,
  to: OrderStatus,
  options: TransitionOptions,
) {
  if (options.tx) return runTransition(options.tx, orderId, to, options);
  return prisma.$transaction((tx) => runTransition(tx, orderId, to, options));
}

/* ───────────────────────────── القراءة والصلاحيات ───────────────────────────── */

const BUCKETS: Record<string, OrderStatus[]> = {
  new: ['PENDING'],
  active: ['SHOP_ACCEPTED', 'PREPARING'],
  ready: ['READY_FOR_PICKUP', 'DRIVER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'NO_DRIVER'],
  completed: ['DELIVERED'],
  cancelled: ['REJECTED', 'CANCELLED', 'FAILED_DELIVERY'],
};

function statusFilter(query: ListOrdersQuery) {
  if (query.status) return { status: query.status };
  if (query.bucket) return { status: { in: BUCKETS[query.bucket] } };
  return {};
}

export async function listCustomerOrders(customerId: string, query: ListOrdersQuery) {
  const where = { customerId, ...statusFilter(query) };
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: customerOrderSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.order.count({ where }),
  ]);
  return paginated(items, total, query);
}

export async function listShopOrders(shopId: string, query: ListOrdersQuery) {
  const where = { shopId, ...statusFilter(query) };
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: shopOrderSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.order.count({ where }),
  ]);
  return paginated(items.map(toShopOrderView), total, query);
}

/** سجل عمليات الاستلام/التسليم (للإدارة) */
const scanSelect = {
  stage: true,
  method: true,
  createdAt: true,
  driver: { select: { id: true, user: { select: { fullName: true, phone: true } } } },
} as const;

export type OrderViewerRole = 'CUSTOMER' | 'SHOP' | 'DRIVER' | 'ADMIN';

/** يحدد صفة المستخدم في الطلب — الزبون أو صاحب المحل أو الموصّل المعيَّن أو الإدارة */
async function resolveViewer(
  order: { customerId: string; shop: { ownerId: string }; driverId: string | null },
  userId: string,
  role: string,
): Promise<OrderViewerRole> {
  if (role === 'ADMIN' || role === 'SUPER_ADMIN') return 'ADMIN';
  if (order.customerId === userId) return 'CUSTOMER';
  if (order.shop.ownerId === userId) return 'SHOP';
  if (order.driverId) {
    const driver = await prisma.driverProfile.findUnique({
      where: { id: order.driverId },
      select: { userId: true },
    });
    if (driver?.userId === userId) return 'DRIVER';
  }
  throw forbidden('لا يمكنك الاطلاع على هذا الطلب');
}

/**
 * يعيد الطلب فقط إن كان المستخدم طرفًا فيه، بالشكل المناسب لكل طرف:
 * - الزبون: المنتجات + التوصيل + الإجمالي + رمز التسليم (QR و PIN).
 * - المحل: قيمة المنتجات فقط والمبلغ الذي يستلمه من الموصّل — لا رسوم توصيل ولا إجمالي.
 * - الموصّل: الحساب الكامل (ما يدفعه للمحل وما يقبضه من الزبون وما يبقى معه). لا يرى رمز الاستلام:
 *   عليه أن يمسحه من المحل.
 * - الإدارة: كل شيء، بما فيه الرموز وسجل العمليات.
 */
export async function getOrderForUser(
  orderId: string,
  userId: string,
  role: string,
): Promise<Record<string, unknown>> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      ...shopOrderSelect,
      customerId: true,
      driverId: true,
      platformFee: true,
      shop: { select: { ...shopOrderSelect.shop.select, ownerId: true } },
    },
  });
  if (!order) throw notFound('الطلب غير موجود');

  const viewer = await resolveViewer(order, userId, role);

  // حصة قفة لا تُعرض إلا ضمن التسوية للموصّل والإدارة
  const { shop, customerId: _c, driverId: _d, platformFee: _pf, ...rest } = order;
  const { ownerId: _ownerId, ...publicShop } = shop;
  const base = { ...rest, shop: publicShop };
  const active = qrVisible(order.status);

  if (viewer === 'SHOP') {
    const tokens = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { pickupToken: true },
    });
    return toShopOrderView({
      ...base,
      // رمز الاستلام يُعرض في المحل ليمسحه الموصّل
      pickupQr: active ? buildQrPayload('P', tokens.pickupToken) : null,
      deliveryQr: null,
    });
  }

  const settlement = orderSettlement(order);
  const amounts = {
    productsAmount: settlement.productsAmount,
    deliveryFee: settlement.deliveryFee,
    discount: settlement.discount,
    total: settlement.total,
  };

  if (viewer === 'CUSTOMER') {
    const tokens = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { deliveryToken: true, deliveryPin: true },
    });
    return {
      ...base,
      amounts,
      pickupQr: null,
      deliveryQr: active ? buildQrPayload('D', tokens.deliveryToken) : null,
      // رمز التسليم القصير: يعطيه الزبون للموصّل عند الاستلام
      deliveryPin: active ? tokens.deliveryPin : null,
    };
  }

  if (viewer === 'DRIVER') {
    return { ...base, amounts, settlement, pickupQr: null, deliveryQr: null };
  }

  // الإدارة
  const extra = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      pickupToken: true,
      deliveryToken: true,
      deliveryPin: true,
      commissionAmount: true,
      driverEarning: true,
      scans: { select: scanSelect, orderBy: { createdAt: 'asc' } },
    },
  });
  return {
    ...base,
    amounts,
    settlement,
    commissionAmount: extra.commissionAmount,
    driverEarning: extra.driverEarning,
    scans: extra.scans,
    pickupQr: buildQrPayload('P', extra.pickupToken),
    deliveryQr: buildQrPayload('D', extra.deliveryToken),
    deliveryPin: extra.deliveryPin,
  };
}

/* ───────────────────────────── الفاتورة ───────────────────────────── */

const PAYMENT_LABEL: Record<string, string> = { CASH_ON_DELIVERY: 'نقدًا عند الاستلام' };

/**
 * فاتورة الطلب — للزبون والإدارة فقط (المحل لا يرى رسوم التوصيل، فلا يحصل على هذه الفاتورة).
 */
export async function getOrderInvoice(orderId: string, userId: string, role: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      status: true,
      createdAt: true,
      deliveredAt: true,
      subtotal: true,
      deliveryFee: true,
      platformFee: true,
      total: true,
      paymentMethod: true,
      customerId: true,
      driverId: true,
      deliveryToken: true,
      deliveryAddressLine: true,
      deliveryCity: true,
      customerPhone: true,
      customer: { select: { fullName: true } },
      shop: { select: { name: true, phone: true, addressLine: true, city: true, ownerId: true } },
      items: {
        select: { nameSnapshot: true, unitSnapshot: true, unitPrice: true, quantity: true, lineTotal: true },
      },
    },
  });
  if (!order) throw notFound('الطلب غير موجود');
  const viewer = await resolveViewer(order, userId, role);
  if (viewer !== 'CUSTOMER' && viewer !== 'ADMIN') {
    throw forbidden('الفاتورة متاحة للزبون والإدارة فقط');
  }

  const s = orderSettlement(order);
  return {
    brand: 'QOFFA',
    title: `فاتورة الطلب ${order.code}`,
    orderId: order.id,
    orderCode: order.code,
    status: order.status,
    date: order.createdAt,
    deliveredAt: order.deliveredAt,
    shop: {
      name: order.shop.name,
      phone: order.shop.phone,
      address: `${order.shop.addressLine}، ${order.shop.city}`,
    },
    customer: {
      fullName: order.customer.fullName,
      phone: order.customerPhone,
      address: `${order.deliveryAddressLine}، ${order.deliveryCity}`,
    },
    items: order.items.map((i) => ({
      name: i.nameSnapshot,
      unit: i.unitSnapshot,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
    productsTotal: s.productsAmount,
    deliveryFee: s.deliveryFee,
    discount: s.discount,
    total: s.total,
    currency: 'DZD',
    paymentMethod: order.paymentMethod,
    paymentLabel: PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod,
    paymentNote: `المبلغ النهائي ${s.total} دج يشمل رسوم التوصيل (${s.deliveryFee} دج)، ويُدفع كاملًا للموصّل نقدًا عند الاستلام.`,
    qr: buildQrPayload('D', order.deliveryToken),
  };
}

/* ───────────────────────────── الاستلام والتسليم ───────────────────────────── */

const flowError = (status: number, code: string, message: string) =>
  new AppError(status, code, message);

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === 'P2002';

/** يفسّر رمزًا لا يطابق هذا الطلب: رمز لطلب آخر أم رمز غير معروف (دون كشف الطلب الآخر) */
async function mismatchError(kind: 'P' | 'D', token: string, orderCode: string) {
  const other = await prisma.order.findFirst({
    where: kind === 'P' ? { pickupToken: token } : { deliveryToken: token },
    select: { id: true },
  });
  if (other) {
    return flowError(409, 'QR_OTHER_ORDER', `هذا الرمز يخص طلبية أخرى وليس الطلب ${orderCode}`);
  }
  return flowError(400, 'QR_INVALID', 'رمز QR غير معروف أو قديم');
}

/**
 * استلام الموصّل للطلب من المحل بمسح QR الطلبية.
 * يتحقق من: صحة الرمز، وجود الطلب، أن الموصّل هو المعيَّن، أن الحالة تسمح، وأن الرمز لم يُستعمل للاستلام.
 * عند النجاح (مرة واحدة فقط): يسجّل العملية، ثم PICKED_UP → OUT_FOR_DELIVERY، ويُعلم الزبون والمحل.
 */
export async function pickupOrderWithQr(
  orderId: string,
  driver: { userId: string; profileId: string },
  rawPayload: unknown,
) {
  const parsed = parseQrPayload(rawPayload);
  if (!parsed) throw flowError(400, 'QR_INVALID', 'رمز QR غير صالح — ليس رمز طلبية من قُفّة');
  if (parsed.kind !== 'P') {
    throw flowError(409, 'QR_WRONG_STAGE', 'هذا رمز التسليم الخاص بالزبون. امسح رمز الطلبية المعروض في المحل.');
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      status: true,
      driverId: true,
      customerId: true,
      pickupToken: true,
      subtotal: true,
      deliveryFee: true,
      total: true,
      platformFee: true,
      shop: { select: { ownerId: true } },
      scans: { where: { stage: 'PICKUP' }, select: { id: true } },
    },
  });
  if (!order) throw notFound('الطلب غير موجود');
  if (order.driverId !== driver.profileId) {
    throw flowError(403, 'NOT_ASSIGNED_DRIVER', 'هذا الطلب غير مُسند إليك — لا يمكنك استلامه');
  }
  if (parsed.token !== order.pickupToken) throw await mismatchError('P', parsed.token, order.code);
  if (order.scans.length > 0) {
    throw flowError(409, 'QR_ALREADY_USED', 'تم استلام هذا الطلب مسبقًا بهذا الرمز');
  }
  if (isTerminal(order.status) || order.status === 'FAILED_DELIVERY') {
    throw flowError(409, 'QR_EXPIRED', 'انتهت صلاحية هذا الرمز — الطلب لم يعد قيد التوصيل');
  }
  if (order.status !== 'DRIVER_ASSIGNED') {
    throw flowError(409, 'QR_WRONG_STAGE', 'الطلب ليس في مرحلة الاستلام من المحل');
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      // القيد الفريد (orderId, PICKUP) يضمن استلامًا واحدًا حتى مع طلبين متزامنين
      await tx.orderScan.create({
        data: { orderId, stage: 'PICKUP', method: 'QR', driverId: driver.profileId },
      });
      await tx.order.updateMany({
        where: { id: orderId, pickupVerifiedAt: null },
        data: { pickupVerifiedAt: now },
      });
      const common = { actorType: 'DRIVER' as const, actorId: driver.userId, tx, silent: true };
      await runTransition(tx, orderId, 'PICKED_UP', { ...common, note: 'استلام من المحل بمسح QR' });
      await runTransition(tx, orderId, 'OUT_FOR_DELIVERY', common);
      await notifyMany(tx, [
        {
          userId: order.customerId,
          type: 'ORDER_OUT_FOR_DELIVERY',
          title: '🛵 طلبك في الطريق إليك',
          body: `الموصّل استلم طلبك ${order.code} من المحل وهو في الطريق إليك.`,
          orderId,
        },
        {
          userId: order.shop.ownerId,
          type: 'ORDER_PICKED_UP',
          title: 'تم استلام الطلب من طرف الموصّل',
          body: `استلم الموصّل الطلب ${order.code}. المبلغ الذي تستلمه من الموصّل: ${order.subtotal} دج.`,
          orderId,
        },
      ]);
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw flowError(409, 'QR_ALREADY_USED', 'تم استلام هذا الطلب مسبقًا بهذا الرمز');
    }
    throw err;
  }

  return {
    ok: true as const,
    from: 'DRIVER_ASSIGNED' as const,
    to: 'OUT_FOR_DELIVERY' as const,
    pickedUpAt: now,
    order: { id: order.id, code: order.code },
    settlement: orderSettlement(order),
  };
}

/** عدد محاولات PIN الخاطئة قبل القفل (يبقى مسح QR الزبون متاحًا) */
export const MAX_PIN_ATTEMPTS = 5;

const pinMatches = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * تأكيد التسليم للزبون: بمسح QR الزبون أو بإدخال PIN الذي يعطيه الزبون.
 * بعد النجاح: DELIVERED (مرة واحدة فقط) وتُسجَّل العملية والتسوية المالية.
 */
export async function confirmDelivery(
  orderId: string,
  driver: { userId: string; profileId: string },
  input: { payload?: string; pin?: string },
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      status: true,
      driverId: true,
      deliveryToken: true,
      deliveryPin: true,
      deliveryPinAttempts: true,
      subtotal: true,
      deliveryFee: true,
      total: true,
      platformFee: true,
    },
  });
  if (!order || order.driverId !== driver.profileId) throw notFound('هذا الطلب غير مُسند إليك');
  if (order.status === 'DELIVERED') {
    throw flowError(409, 'ALREADY_DELIVERED', 'تم تسليم هذا الطلب مسبقًا');
  }
  // يرمي 409 إن لم تكن الحالة تسمح بالتسليم (مثلًا قبل الاستلام من المحل)
  assertTransition(order.status, 'DELIVERED', 'DRIVER');

  let method: 'QR' | 'PIN';
  if (input.payload) {
    const parsed = parseQrPayload(input.payload);
    if (!parsed) throw flowError(400, 'QR_INVALID', 'رمز QR غير صالح — ليس رمز طلبية من قُفّة');
    if (parsed.kind !== 'D') {
      throw flowError(409, 'QR_WRONG_STAGE', 'هذا رمز الاستلام من المحل. امسح الرمز على هاتف الزبون.');
    }
    if (parsed.token !== order.deliveryToken) throw await mismatchError('D', parsed.token, order.code);
    method = 'QR';
  } else if (input.pin) {
    if (order.deliveryPinAttempts >= MAX_PIN_ATTEMPTS) {
      throw flowError(429, 'PIN_LOCKED', 'تجاوزت عدد المحاولات. امسح رمز QR على هاتف الزبون.');
    }
    if (!pinMatches(input.pin, order.deliveryPin)) {
      const updated = await prisma.order.update({
        where: { id: orderId },
        data: { deliveryPinAttempts: { increment: 1 } },
        select: { deliveryPinAttempts: true },
      });
      const left = Math.max(0, MAX_PIN_ATTEMPTS - updated.deliveryPinAttempts);
      throw flowError(400, 'PIN_INVALID', `رمز التسليم غير صحيح. المحاولات المتبقية: ${left}`);
    }
    method = 'PIN';
  } else {
    throw flowError(
      400,
      'CONFIRMATION_REQUIRED',
      'لتأكيد التسليم امسح رمز QR الزبون أو أدخل رمز التسليم الذي يعطيك إياه',
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.orderScan.create({
        data: { orderId, stage: 'DELIVERY', method, driverId: driver.profileId },
      });
      await tx.order.updateMany({
        where: { id: orderId, deliveryVerifiedAt: null },
        data: { deliveryVerifiedAt: new Date() },
      });
      await runTransition(tx, orderId, 'DELIVERED', {
        actorType: 'DRIVER',
        actorId: driver.userId,
        note: method === 'QR' ? 'تسليم مؤكَّد بمسح QR الزبون' : 'تسليم مؤكَّد برمز PIN',
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw flowError(409, 'ALREADY_DELIVERED', 'تم تسليم هذا الطلب مسبقًا');
    throw err;
  }

  return {
    ok: true as const,
    from: order.status,
    to: 'DELIVERED' as const,
    method,
    settlement: orderSettlement(order),
  };
}

export async function getOrderTimeline(orderId: string) {
  return prisma.orderStatusEvent.findMany({
    where: { orderId },
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      actorType: true,
      note: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

/** يتأكد أن الطلب يخص هذا الزبون */
export async function assertCustomerOrder(orderId: string, customerId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId },
    select: { id: true, status: true },
  });
  if (!order) throw notFound('الطلب غير موجود');
  return order;
}

/** يتأكد أن الطلب يخص محل هذا المالك */
export async function assertShopOrder(orderId: string, ownerId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, shop: { ownerId } },
    select: { id: true, status: true, shopId: true },
  });
  if (!order) throw notFound('الطلب غير موجود في محلك');
  return order;
}

export type { Pagination };
