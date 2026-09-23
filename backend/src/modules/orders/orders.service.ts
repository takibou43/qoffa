import { env } from '../../config/env.js';
import { generateOrderCode } from '../../lib/code.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
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
  type DeliveryQuote,
} from '../../services/deliveryPricing.js';
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

export async function createOrder(customerId: string, input: CreateOrderInput) {
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

  // التوفر والكمية خاصان بعرض هذا المحل (ShopProduct)
  const unavailable = products
    .filter((p) => !p.isAvailable || (p.stock !== null && p.stock < (quantities.get(p.id) ?? 0)))
    .map((p) => p.product.name);
  if (unavailable.length > 0) {
    throw conflict('بعض المنتجات غير متوفرة حاليًا', { products: unavailable });
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
  const customer = await prisma.user.findUniqueOrThrow({
    where: { id: customerId },
    select: { phone: true },
  });

  const orderId = await prisma.$transaction(async (tx) => {
    // داخل المعاملة نُنشئ بأقل قدر من الحقول؛ القراءة الكاملة بعلاقاتها تتم بعد الالتزام
    const created = await tx.order.create({
      data: {
        code: generateOrderCode(),
        customerId,
        shopId: shop.id,
        status: 'PENDING',
        subtotal,
        deliveryFee,
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
        items: { createMany: { data: items } },
      },
      select: { id: true, code: true, total: true },
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
        body: `وصلك طلب جديد ${created.code} بقيمة ${created.total} دج.`,
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
  });

  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
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
      },
      {
        commissionBps: order.shop.commissionBps,
        driverFeeShareBps: env.DRIVER_FEE_SHARE_BPS,
      },
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
  const template = STATUS_NOTIFICATION[to];
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
  return paginated(items, total, query);
}

/** يعيد الطلب فقط إن كان المستخدم طرفًا فيه — الزبون أو صاحب المحل أو الموصّل المعيَّن أو الإدارة */
export async function getOrderForUser(
  orderId: string,
  userId: string,
  role: string,
): Promise<Record<string, unknown>> {
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { ...shopOrderSelect, shop: { select: { ...shopOrderSelect.shop.select, ownerId: true } } },
  });
  if (!order) throw notFound('الطلب غير موجود');

  if (isAdmin) return order as unknown as Record<string, unknown>;

  const isCustomer = order.customer?.id === userId;
  const isShopOwner = (order.shop as { ownerId?: string }).ownerId === userId;
  const driverUser = await (order.driver
    ? prisma.driverProfile.findUnique({
        where: { id: (order.driver as { id: string }).id },
        select: { userId: true },
      })
    : Promise.resolve(null));
  const isDriver = driverUser?.userId === userId;

  if (!isCustomer && !isShopOwner && !isDriver) {
    throw forbidden('لا يمكنك الاطلاع على هذا الطلب');
  }

  // الزبون لا يحتاج بيانات المحل الداخلية
  const { shop, ...rest } = order;
  const { ownerId: _ownerId, ...publicShop } = shop as Record<string, unknown>;
  return { ...rest, shop: publicShop };
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
