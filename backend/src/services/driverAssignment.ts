/**
 * قُفّة — مطابقة الموصّلين.
 *
 * المبدأ: الطلب الجاهز يُعرض على أقرب موصّل متاح واحدًا تلو الآخر (عرض حصري بمهلة)،
 * ولا يُترك مفتوحًا للجميع. القبول محمي ضد السباق بقفل تفاؤلي على مستوى قاعدة البيانات.
 */
import { env } from '../config/env.js';
import { conflict, notFound } from '../lib/errors.js';
import { boundingBox, haversineMeters } from '../lib/geo.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import { notify } from './notifications.js';
import { transitionOrder } from '../modules/orders/orders.service.js';

export interface CandidateDriver {
  id: string;
  userId: string;
  distanceMeters: number;
}

/**
 * الموصّلون المؤهلون لطلب معيّن، مرتّبون بالأقرب إلى المحل.
 * الشروط: معتمد، متاح، لا يحمل طلبًا حاليًا، حسابه فعّال، موقعه معروف،
 * ولم يُعرض عليه هذا الطلب من قبل.
 */
export async function findCandidateDrivers(
  orderId: string,
  limit = 10,
): Promise<CandidateDriver[]> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, shop: { select: { latitude: true, longitude: true } } },
  });
  if (!order) throw notFound('الطلب غير موجود');

  const { latitude: shopLat, longitude: shopLon } = order.shop;
  const box = boundingBox(shopLat, shopLon, env.SEARCH_RADIUS_KM);

  const alreadyOffered = await prisma.deliveryOffer.findMany({
    where: { orderId },
    select: { driverId: true },
  });
  const excluded = alreadyOffered.map((o) => o.driverId);

  const drivers = await prisma.driverProfile.findMany({
    where: {
      status: 'APPROVED',
      isAvailable: true,
      currentOrderId: null,
      latitude: { gte: box.minLat, lte: box.maxLat },
      longitude: { gte: box.minLon, lte: box.maxLon },
      user: { status: 'ACTIVE' },
      ...(excluded.length > 0 ? { id: { notIn: excluded } } : {}),
    },
    select: { id: true, userId: true, latitude: true, longitude: true },
    take: 100,
  });

  const radiusM = env.SEARCH_RADIUS_KM * 1000;
  return drivers
    .map((d) => ({
      id: d.id,
      userId: d.userId,
      distanceMeters: haversineMeters(shopLat, shopLon, d.latitude!, d.longitude!),
    }))
    .filter((d) => d.distanceMeters <= radiusM)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

/**
 * يعرض الطلب على الموصّل التالي الأقرب.
 * يعيد العرض المُنشأ، أو null إن لم يبق موصّل مؤهل.
 */
export async function offerToNextDriver(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, code: true, status: true, offerAttempts: true, total: true },
  });
  if (!order) throw notFound('الطلب غير موجود');
  if (order.status !== 'READY_FOR_PICKUP') return null;

  // عرض معلّق وما زال ساريًا؟ لا نعرضه على غيره
  const activeOffer = await prisma.deliveryOffer.findFirst({
    where: { orderId, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (activeOffer) return null;

  if (order.offerAttempts >= env.MAX_DRIVER_OFFERS) {
    await markNoDriver(orderId);
    return null;
  }

  const [candidate] = await findCandidateDrivers(orderId, 1);
  if (!candidate) {
    // لا يوجد موصّل الآن — نسجّل الحالة ونُبقي الطلب قابلًا لإعادة المحاولة
    await markNoDriver(orderId);
    return null;
  }

  const expiresAt = new Date(Date.now() + env.DRIVER_OFFER_TIMEOUT_SECONDS * 1000);

  return prisma.$transaction(async (tx) => {
    const offer = await tx.deliveryOffer.create({
      data: {
        orderId,
        driverId: candidate.id,
        status: 'PENDING',
        distanceMeters: candidate.distanceMeters,
        expiresAt,
      },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { offerAttempts: { increment: 1 } },
    });
    await notify(tx, {
      userId: candidate.userId,
      type: 'NEW_DELIVERY_OFFER',
      title: 'طلب توصيل جديد',
      body: `طلب ${order.code} بقيمة ${order.total} دج على بعد ${Math.round(
        candidate.distanceMeters / 100,
      ) / 10} كم.`,
      orderId,
    });
    return offer;
  });
}

async function markNoDriver(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true },
  });
  if (order?.status !== 'READY_FOR_PICKUP') return;
  await transitionOrder(orderId, 'NO_DRIVER', {
    actorType: 'SYSTEM',
    note: 'لم يُعثر على موصّل متاح',
  });
}

/**
 * قبول عرض التوصيل.
 *
 * الحماية من السباق تتم على مستويين داخل معاملة واحدة:
 *  1. قفل الموصّل: updateMany مشروط بـ currentOrderId = null.
 *  2. قفل الطلب: transitionOrder يستعمل updateMany مشروطًا بالحالة و driverId = null.
 * إن سبق موصّل آخر، يعيد أحد القفلين count = 0 وتُرجَع المعاملة بالكامل.
 */
export async function acceptDeliveryOffer(driverProfileId: string, orderId: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const offer = await tx.deliveryOffer.findUnique({
      where: { orderId_driverId: { orderId, driverId: driverProfileId } },
      select: { id: true, status: true, expiresAt: true, distanceMeters: true },
    });
    if (!offer) throw notFound('لم يُعرض عليك هذا الطلب');
    if (offer.status !== 'PENDING') throw conflict('هذا العرض لم يعد متاحًا');
    if (offer.expiresAt.getTime() < Date.now()) {
      await tx.deliveryOffer.update({
        where: { id: offer.id },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      });
      throw conflict('انتهت مهلة قبول هذا الطلب');
    }

    // 1) قفل الموصّل — يمنعه من حمل طلبين
    const lock = await tx.driverProfile.updateMany({
      where: {
        id: driverProfileId,
        currentOrderId: null,
        status: 'APPROVED',
        isAvailable: true,
      },
      data: { currentOrderId: orderId },
    });
    if (lock.count === 0) {
      throw conflict('لديك طلب جارٍ بالفعل أو حسابك غير متاح');
    }

    // 2) قفل الطلب — يفوز موصّل واحد فقط
    await transitionOrder(orderId, 'DRIVER_ASSIGNED', {
      actorType: 'DRIVER',
      driverId: driverProfileId,
      tx,
    });

    await tx.deliveryOffer.update({
      where: { id: offer.id },
      data: { status: 'ACCEPTED', respondedAt: new Date() },
    });

    const delivery = await tx.delivery.upsert({
      where: { orderId },
      update: { driverId: driverProfileId, acceptedAt: new Date() },
      create: {
        orderId,
        driverId: driverProfileId,
        distanceMeters: offer.distanceMeters,
      },
    });

    return delivery;
  });
}

/** رفض العرض — ينتقل الطلب فورًا إلى الموصّل التالي */
export async function declineDeliveryOffer(driverProfileId: string, orderId: string) {
  const offer = await prisma.deliveryOffer.findUnique({
    where: { orderId_driverId: { orderId, driverId: driverProfileId } },
    select: { id: true, status: true },
  });
  if (!offer) throw notFound('لم يُعرض عليك هذا الطلب');
  if (offer.status !== 'PENDING') throw conflict('هذا العرض لم يعد متاحًا');

  await prisma.deliveryOffer.update({
    where: { id: offer.id },
    data: { status: 'DECLINED', respondedAt: new Date() },
  });

  await offerToNextDriver(orderId);
}

/**
 * دورة الصيانة: تُنهي العروض المنتهية وتعرض الطلبات على الموصّل التالي.
 * تُستدعى من مؤقّت الخادم، ويمكن استدعاؤها يدويًا في الاختبارات.
 */
export async function runDispatchTick(now = new Date()) {
  const expired = await prisma.deliveryOffer.findMany({
    where: { status: 'PENDING', expiresAt: { lte: now } },
    select: { id: true, orderId: true },
  });

  if (expired.length > 0) {
    await prisma.deliveryOffer.updateMany({
      where: { id: { in: expired.map((o) => o.id) } },
      data: { status: 'EXPIRED', respondedAt: now },
    });
  }

  // الطلبات الجاهزة بلا عرض ساري (يشمل التي انتهت عروضها للتو)
  const pendingOrders = await prisma.order.findMany({
    where: {
      status: 'READY_FOR_PICKUP',
      offers: { none: { status: 'PENDING', expiresAt: { gt: now } } },
    },
    select: { id: true },
    take: 50,
  });

  let offered = 0;
  for (const order of pendingOrders) {
    try {
      const offer = await offerToNextDriver(order.id);
      if (offer) offered++;
    } catch (err) {
      console.error('[dispatch] فشل عرض الطلب', order.id, err);
    }
  }

  return { expired: expired.length, offered };
}

let lastOpportunisticTick = 0;

/**
 * تشغيل انتهازي لدورة المطابقة، للبيئات التي لا تسمح بمؤقّت دائم (Serverless).
 * يُستدعى من مسارات يزورها الموصّلون والمحلات بانتظام، ويُنفَّذ مرة واحدة كل فترة.
 */
export async function maybeRunDispatchTick(minIntervalMs = 8_000) {
  const now = Date.now();
  if (now - lastOpportunisticTick < minIntervalMs) return;
  lastOpportunisticTick = now;
  try {
    await runDispatchTick();
  } catch (err) {
    console.error('[dispatch] فشل التشغيل الانتهازي', err);
  }
}

let timer: NodeJS.Timeout | null = null;

/** يشغّل مؤقّت المطابقة — يُستدعى من index.ts فقط */
export function startDispatcher(intervalMs = 10_000) {
  if (timer) return;
  timer = setInterval(() => {
    runDispatchTick().catch((err) => console.error('[dispatch] خطأ في الدورة', err));
  }, intervalMs);
  timer.unref();
}

export function stopDispatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}
