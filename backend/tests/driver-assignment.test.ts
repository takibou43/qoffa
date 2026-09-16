import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ALGIERS, bearer, createCustomer, createDriver, createProduct, createShop, resetDb } from './helpers/factories.js';
import { prisma } from '../src/lib/prisma.js';
import { transitionOrder } from '../src/modules/orders/orders.service.js';
import {
  acceptDeliveryOffer,
  findCandidateDrivers,
  offerToNextDriver,
  runDispatchTick,
} from '../src/services/driverAssignment.js';

const app = createApp();

let shop: Awaited<ReturnType<typeof createShop>>;
let customer: Awaited<ReturnType<typeof createCustomer>>;
let product: Awaited<ReturnType<typeof createProduct>>;

/** ينشئ طلبًا ويوصله إلى READY_FOR_PICKUP دون إطلاق العرض التلقائي */
async function readyOrder() {
  const order = await prisma.order.create({
    data: {
      code: `QF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      customerId: customer.user.id,
      shopId: shop.shop.id,
      status: 'READY_FOR_PICKUP',
      subtotal: 300,
      deliveryFee: 150,
      total: 450,
      addressId: customer.address.id,
      deliveryAddressLine: customer.address.addressLine,
      deliveryCity: customer.address.city,
      deliveryLatitude: customer.address.latitude,
      deliveryLongitude: customer.address.longitude,
      customerPhone: customer.user.phone,
      readyAt: new Date(),
      items: {
        create: [
          {
            productId: product.id,
            nameSnapshot: product.name,
            unitSnapshot: product.unit,
            unitPrice: product.price,
            quantity: 3,
            lineTotal: product.price * 3,
          },
        ],
      },
    },
  });
  return order;
}

/** عرض مباشر لطلب على موصّل معيّن */
async function offerTo(orderId: string, driverProfileId: string, ttlSeconds = 60) {
  return prisma.deliveryOffer.create({
    data: {
      orderId,
      driverId: driverProfileId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    },
  });
}

beforeEach(async () => {
  await resetDb();
  shop = await createShop({ isOpen: true });
  customer = await createCustomer();
  product = await createProduct(shop.shop.id, { name: 'حليب', price: 100 });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('اختيار الموصّلين المؤهلين', () => {
  it('يرتّب الموصّلين بالأقرب إلى المحل', async () => {
    const near = await createDriver({ lat: ALGIERS.lat + 0.002, lon: ALGIERS.lon });
    const mid = await createDriver({ lat: ALGIERS.lat + 0.02, lon: ALGIERS.lon });
    const far = await createDriver({ lat: ALGIERS.lat + 0.05, lon: ALGIERS.lon });

    const order = await readyOrder();
    const candidates = await findCandidateDrivers(order.id, 10);

    expect(candidates.map((c) => c.id)).toEqual([near.profile.id, mid.profile.id, far.profile.id]);
    expect(candidates[0]!.distanceMeters).toBeLessThan(candidates[1]!.distanceMeters);
  });

  it('يستبعد غير المتاح وغير المعتمد ومن يحمل طلبًا', async () => {
    await createDriver({ isAvailable: false });
    await createDriver({ status: 'PENDING' });
    await createDriver({ status: 'SUSPENDED' });
    const busy = await createDriver();
    const free = await createDriver();

    const other = await readyOrder();
    await prisma.driverProfile.update({
      where: { id: busy.profile.id },
      data: { currentOrderId: other.id },
    });

    const order = await readyOrder();
    const candidates = await findCandidateDrivers(order.id, 10);
    expect(candidates.map((c) => c.id)).toEqual([free.profile.id]);
  });

  it('يستبعد الموصّل صاحب الحساب المعلّق', async () => {
    const suspended = await createDriver();
    await prisma.user.update({
      where: { id: suspended.user.id },
      data: { status: 'SUSPENDED' },
    });

    const order = await readyOrder();
    expect(await findCandidateDrivers(order.id, 10)).toHaveLength(0);
  });

  it('يستبعد من هو خارج نصف قطر البحث', async () => {
    // ~40 كم شمالًا، خارج SEARCH_RADIUS_KM = 10
    await createDriver({ lat: ALGIERS.lat + 0.36, lon: ALGIERS.lon });
    const order = await readyOrder();
    expect(await findCandidateDrivers(order.id, 10)).toHaveLength(0);
  });

  it('لا يعرض الطلب مرتين على نفس الموصّل', async () => {
    const driver = await createDriver();
    const order = await readyOrder();

    await offerToNextDriver(order.id);
    const candidates = await findCandidateDrivers(order.id, 10);
    expect(candidates).toHaveLength(0);
    expect(candidates.map((c) => c.id)).not.toContain(driver.profile.id);
  });
});

describe('دورة العروض', () => {
  it('يعرض على الأقرب أولًا ويُشعره', async () => {
    const near = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    await createDriver({ lat: ALGIERS.lat + 0.04, lon: ALGIERS.lon });

    const order = await readyOrder();
    const offer = await offerToNextDriver(order.id);

    expect(offer).not.toBeNull();
    expect(offer!.driverId).toBe(near.profile.id);

    const notif = await prisma.notification.findFirst({
      where: { userId: near.user.id, type: 'NEW_DELIVERY_OFFER' },
    });
    expect(notif).not.toBeNull();
  });

  it('لا يعرض الطلب على أكثر من موصّل في نفس الوقت', async () => {
    await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    await createDriver({ lat: ALGIERS.lat + 0.002, lon: ALGIERS.lon });

    const order = await readyOrder();
    await offerToNextDriver(order.id);
    const second = await offerToNextDriver(order.id);

    expect(second).toBeNull();
    const pending = await prisma.deliveryOffer.count({
      where: { orderId: order.id, status: 'PENDING' },
    });
    expect(pending).toBe(1);
  });

  it('عند الرفض ينتقل العرض إلى الموصّل التالي', async () => {
    const first = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const second = await createDriver({ lat: ALGIERS.lat + 0.01, lon: ALGIERS.lon });

    const order = await readyOrder();
    await offerToNextDriver(order.id);

    const res = await request(app)
      .post(`/api/drivers/offers/${order.id}/decline`)
      .set(bearer(first.token));
    expect(res.status).toBe(200);

    const offers = await prisma.deliveryOffer.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(offers).toHaveLength(2);
    expect(offers[0]!.status).toBe('DECLINED');
    expect(offers[1]!.driverId).toBe(second.profile.id);
    expect(offers[1]!.status).toBe('PENDING');
  });

  it('الدورة الدورية تُنهي العروض المنتهية وتعرض على التالي', async () => {
    const first = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const second = await createDriver({ lat: ALGIERS.lat + 0.01, lon: ALGIERS.lon });

    const order = await readyOrder();
    await offerTo(order.id, first.profile.id, -1); // منتهٍ بالفعل
    await prisma.order.update({ where: { id: order.id }, data: { offerAttempts: 1 } });

    const result = await runDispatchTick();
    expect(result.expired).toBe(1);
    expect(result.offered).toBe(1);

    const offers = await prisma.deliveryOffer.findMany({ where: { orderId: order.id } });
    expect(offers.find((o) => o.driverId === first.profile.id)!.status).toBe('EXPIRED');
    expect(offers.find((o) => o.driverId === second.profile.id)!.status).toBe('PENDING');
  });

  it('ينتقل إلى NO_DRIVER عند عدم وجود موصّل، دون إلغاء الطلب', async () => {
    const order = await readyOrder();
    const offer = await offerToNextDriver(order.id);

    expect(offer).toBeNull();
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('NO_DRIVER');
    expect(updated.closedAt).toBeNull(); // ليست حالة نهائية

    const notified = await prisma.notification.findFirst({
      where: { orderId: order.id, type: 'NO_DRIVER_FOUND' },
    });
    expect(notified).not.toBeNull();
  });

  it('المحل يعيد محاولة البحث بعد NO_DRIVER', async () => {
    const order = await readyOrder();
    await offerToNextDriver(order.id); // → NO_DRIVER
    await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });

    const res = await request(app)
      .post(`/api/orders/${order.id}/retry-dispatch`)
      .set(bearer(shop.token));
    expect(res.status).toBe(200);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('READY_FOR_PICKUP');
    expect(
      await prisma.deliveryOffer.count({ where: { orderId: order.id, status: 'PENDING' } }),
    ).toBe(1);
  });

  it('يتوقف عن العرض بعد MAX_DRIVER_OFFERS', async () => {
    const order = await readyOrder();
    await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    await prisma.order.update({ where: { id: order.id }, data: { offerAttempts: 6 } });

    const offer = await offerToNextDriver(order.id);
    expect(offer).toBeNull();
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('NO_DRIVER');
  });
});

describe('السباق: موصّلان يقبلان نفس الطلب في نفس اللحظة', () => {
  it('يفوز موصّل واحد فقط ويفشل الآخر بوضوح', async () => {
    const a = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const b = await createDriver({ lat: ALGIERS.lat + 0.002, lon: ALGIERS.lon });

    const order = await readyOrder();
    // نعرض الطلب على الاثنين عمدًا لمحاكاة أسوأ سيناريو
    await offerTo(order.id, a.profile.id);
    await offerTo(order.id, b.profile.id);

    const results = await Promise.allSettled([
      acceptDeliveryOffer(a.profile.id, order.id),
      acceptDeliveryOffer(b.profile.id, order.id),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('DRIVER_ASSIGNED');
    expect([a.profile.id, b.profile.id]).toContain(updated.driverId);

    // تسليم واحد فقط، ولا موصّل خاسر يحمل الطلب
    expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(1);
    const holders = await prisma.driverProfile.findMany({
      where: { currentOrderId: order.id },
      select: { id: true },
    });
    expect(holders).toHaveLength(1);
    expect(holders[0]!.id).toBe(updated.driverId);

    // انتقال واحد فقط مسجَّل
    expect(
      await prisma.orderStatusEvent.count({
        where: { orderId: order.id, toStatus: 'DRIVER_ASSIGNED' },
      }),
    ).toBe(1);
  });

  it('يصمد أمام خمسة موصّلين متزامنين', async () => {
    const drivers = [];
    for (let i = 0; i < 5; i++) {
      drivers.push(await createDriver({ lat: ALGIERS.lat + 0.001 * (i + 1), lon: ALGIERS.lon }));
    }
    const order = await readyOrder();
    for (const d of drivers) await offerTo(order.id, d.profile.id);

    const results = await Promise.allSettled(
      drivers.map((d) => acceptDeliveryOffer(d.profile.id, order.id)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('DRIVER_ASSIGNED');
    expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(1);
    expect(await prisma.driverProfile.count({ where: { currentOrderId: order.id } })).toBe(1);
  });

  it('السباق عبر الـAPI أيضًا يُنتج قبولًا واحدًا', async () => {
    const a = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const b = await createDriver({ lat: ALGIERS.lat + 0.002, lon: ALGIERS.lon });

    const order = await readyOrder();
    await offerTo(order.id, a.profile.id);
    await offerTo(order.id, b.profile.id);

    const [r1, r2] = await Promise.all([
      request(app).post(`/api/drivers/offers/${order.id}/accept`).set(bearer(a.token)),
      request(app).post(`/api/drivers/offers/${order.id}/accept`).set(bearer(b.token)),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('الموصّل الذي يحمل طلبًا لا يستطيع قبول طلب آخر', async () => {
    const driver = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const first = await readyOrder();
    const second = await readyOrder();

    await offerTo(first.id, driver.profile.id);
    await offerTo(second.id, driver.profile.id);

    await acceptDeliveryOffer(driver.profile.id, first.id);
    await expect(acceptDeliveryOffer(driver.profile.id, second.id)).rejects.toThrow();

    const secondOrder = await prisma.order.findUniqueOrThrow({ where: { id: second.id } });
    expect(secondOrder.status).toBe('READY_FOR_PICKUP');
    expect(secondOrder.driverId).toBeNull();
  });

  it('العرض المنتهي لا يمكن قبوله', async () => {
    const driver = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const order = await readyOrder();
    await offerTo(order.id, driver.profile.id, -1);

    await expect(acceptDeliveryOffer(driver.profile.id, order.id)).rejects.toThrow();
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('READY_FOR_PICKUP');
  });

  it('موصّل لم يُعرض عليه الطلب لا يستطيع قبوله', async () => {
    const intruder = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const order = await readyOrder();

    const res = await request(app)
      .post(`/api/drivers/offers/${order.id}/accept`)
      .set(bearer(intruder.token));
    expect(res.status).toBe(404);
  });
});

describe('تدفق التوصيل', () => {
  it('يكمل المسار من القبول إلى التسليم ويحرّر الموصّل', async () => {
    const driver = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const order = await readyOrder();
    await offerTo(order.id, driver.profile.id);
    await acceptDeliveryOffer(driver.profile.id, order.id);

    const current = await request(app).get('/api/drivers/me/current').set(bearer(driver.token));
    expect(current.status).toBe(200);
    expect(current.body.order.id).toBe(order.id);
    expect(current.body.order.shop.name).toBeTruthy();
    expect(current.body.order.customerPhone).toBeTruthy();

    for (const path of ['pickup', 'out-for-delivery', 'deliver']) {
      const res = await request(app)
        .post(`/api/orders/${order.id}/${path}`)
        .set(bearer(driver.token));
      expect(res.status, path).toBe(200);
    }

    const delivered = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(delivered.status).toBe('DELIVERED');

    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: driver.profile.id },
    });
    expect(profile.currentOrderId).toBeNull();

    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(delivery.pickedUpAt).not.toBeNull();
    expect(delivery.deliveredAt).not.toBeNull();
    expect(delivery.earning).toBe(120);
  });

  it('يمنع الموصّل من تخطي المراحل', async () => {
    const driver = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const order = await readyOrder();
    await offerTo(order.id, driver.profile.id);
    await acceptDeliveryOffer(driver.profile.id, order.id);

    // تسليم قبل الاستلام
    const early = await request(app)
      .post(`/api/orders/${order.id}/deliver`)
      .set(bearer(driver.token));
    expect(early.status).toBe(409);

    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.status).toBe('DRIVER_ASSIGNED');
  });

  it('موصّل آخر لا يستطيع التصرّف في طلب ليس له', async () => {
    const owner = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const intruder = await createDriver({ lat: ALGIERS.lat + 0.002, lon: ALGIERS.lon });
    const order = await readyOrder();
    await offerTo(order.id, owner.profile.id);
    await acceptDeliveryOffer(owner.profile.id, order.id);

    const res = await request(app)
      .post(`/api/orders/${order.id}/pickup`)
      .set(bearer(intruder.token));
    expect(res.status).toBe(404);
  });

  it('تعذّر التسليم يسجّل السبب ويحرّر الموصّل', async () => {
    const driver = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const order = await readyOrder();
    await offerTo(order.id, driver.profile.id);
    await acceptDeliveryOffer(driver.profile.id, order.id);
    await request(app).post(`/api/orders/${order.id}/pickup`).set(bearer(driver.token));

    const noReason = await request(app)
      .post(`/api/orders/${order.id}/fail-delivery`)
      .set(bearer(driver.token))
      .send({});
    expect(noReason.status).toBe(400);

    const res = await request(app)
      .post(`/api/orders/${order.id}/fail-delivery`)
      .set(bearer(driver.token))
      .send({ reason: 'الزبون لا يرد' });
    expect(res.status).toBe(200);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('FAILED_DELIVERY');

    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(delivery.failReason).toBe('الزبون لا يرد');

    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: driver.profile.id },
    });
    expect(profile.currentOrderId).toBeNull();
  });

  it('انسحاب الموصّل يعيد الطلب للبحث ويحرّره', async () => {
    const first = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const second = await createDriver({ lat: ALGIERS.lat + 0.01, lon: ALGIERS.lon });
    const order = await readyOrder();
    await offerTo(order.id, first.profile.id);
    await acceptDeliveryOffer(first.profile.id, order.id);

    const res = await request(app)
      .post(`/api/orders/${order.id}/release`)
      .set(bearer(first.token));
    expect(res.status).toBe(200);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('READY_FOR_PICKUP');
    expect(updated.driverId).toBeNull();

    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: first.profile.id },
    });
    expect(profile.currentOrderId).toBeNull();

    // عُرض على الموصّل التالي
    const pending = await prisma.deliveryOffer.findFirst({
      where: { orderId: order.id, status: 'PENDING' },
    });
    expect(pending!.driverId).toBe(second.profile.id);
  });

  it('إلغاء الإدارة يحرّر الموصّل ويلغي العروض المعلّقة', async () => {
    const driver = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const order = await readyOrder();
    await offerTo(order.id, driver.profile.id);
    await acceptDeliveryOffer(driver.profile.id, order.id);

    await transitionOrder(order.id, 'CANCELLED', {
      actorType: 'ADMIN',
      reason: 'طلب مكرر',
    });

    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: driver.profile.id },
    });
    expect(profile.currentOrderId).toBeNull();
    expect(
      await prisma.deliveryOffer.count({ where: { orderId: order.id, status: 'PENDING' } }),
    ).toBe(0);
  });
});

describe('حالة الموصّل والموقع', () => {
  it('يبدّل التوفر ويحدّث الموقع', async () => {
    const driver = await createDriver({ isAvailable: false });

    const res = await request(app)
      .patch('/api/drivers/me/availability')
      .set(bearer(driver.token))
      .send({ isAvailable: true, latitude: ALGIERS.lat, longitude: ALGIERS.lon });
    expect(res.status).toBe(200);
    expect(res.body.driver.isAvailable).toBe(true);
    expect(res.body.driver.latitude).toBeCloseTo(ALGIERS.lat, 4);
  });

  it('الموصّل غير المتاح لا يتلقى عروضًا', async () => {
    const driver = await createDriver({ isAvailable: true, lat: ALGIERS.lat, lon: ALGIERS.lon });
    await request(app)
      .patch('/api/drivers/me/availability')
      .set(bearer(driver.token))
      .send({ isAvailable: false });

    const order = await readyOrder();
    expect(await findCandidateDrivers(order.id, 10)).toHaveLength(0);
  });

  it('الموصّل قيد المراجعة لا يستطيع تفعيل التوفر', async () => {
    const driver = await createDriver({ status: 'PENDING', isAvailable: false });
    const res = await request(app)
      .patch('/api/drivers/me/availability')
      .set(bearer(driver.token))
      .send({ isAvailable: true });
    expect(res.status).toBe(403);
  });

  it('لا يُحدَّث الموقع إذا لم يكن متاحًا ولا يحمل طلبًا', async () => {
    const driver = await createDriver({ isAvailable: false });
    const res = await request(app)
      .patch('/api/drivers/me/location')
      .set(bearer(driver.token))
      .send({ latitude: ALGIERS.lat, longitude: ALGIERS.lon });
    expect(res.status).toBe(403);
  });

  it('يمنع غير الموصّل من مسارات الموصّل', async () => {
    for (const token of [customer.token, shop.token]) {
      expect((await request(app).get('/api/drivers/me').set(bearer(token))).status).toBe(403);
    }
  });
});
