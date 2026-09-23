/**
 * دورة الطلب الكاملة: المخزون، رقم الطلب، QR، استلام الموصّل بالمسح، الحساب المالي حسب الطرف،
 * الفاتورة، والتسليم النهائي.
 *
 * المثال المعتمد: منتجات 2000 دج + توصيل 200 دج = 2200 دج.
 */
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { transitionOrder } from '../src/modules/orders/orders.service.js';
import { MAX_PIN_ATTEMPTS } from '../src/modules/orders/orders.service.js';
import { orderSettlement } from '../src/services/orderMoney.js';
import { parseQrPayload } from '../src/services/orderQr.js';
import {
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createProduct,
  createShop,
  deliveryPinFor,
  deliveryQrFor,
  pickupQrFor,
  resetDb,
} from './helpers/factories.js';

const app = createApp();

let shop: Awaited<ReturnType<typeof createShop>>;
let customer: Awaited<ReturnType<typeof createCustomer>>;
let driver: Awaited<ReturnType<typeof createDriver>>;
let admin: Awaited<ReturnType<typeof createAdmin>>;
let productId: string;

const FEE = 200;

async function setDeliveryFee(fee: number) {
  // رسم ثابت: الرسم الأساسي يغطي كل المسافات المسموحة
  for (const [key, value] of [
    ['delivery.baseFee', fee],
    ['delivery.baseKm', 15],
  ] as const) {
    await prisma.platformSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value, label: key, group: 'delivery' },
    });
  }
}

beforeEach(async () => {
  await resetDb();
  await setDeliveryFee(FEE);
  shop = await createShop({ isOpen: true });
  customer = await createCustomer();
  driver = await createDriver();
  admin = await createAdmin('ADMIN');
  // 2 × 1000 = 2000 دج
  productId = (await createProduct(shop.shop.id, { name: 'زيت زيتون', price: 1000, stock: 10 })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const stockOf = async (id: string) =>
  (await prisma.shopProduct.findUniqueOrThrow({ where: { id }, select: { stock: true } })).stock;

function placeOrder(quantity = 2, clientRequestId?: string, c = customer) {
  return request(app)
    .post('/api/orders')
    .set(bearer(c.token))
    .send({
      shopId: shop.shop.id,
      addressId: c.address.id,
      items: [{ productId, quantity }],
      ...(clientRequestId ? { clientRequestId } : {}),
    });
}

async function readyAndAssign(orderId: string, driverProfileId = driver.profile.id) {
  await transitionOrder(orderId, 'SHOP_ACCEPTED', { actorType: 'SHOP' });
  await transitionOrder(orderId, 'PREPARING', { actorType: 'SHOP' });
  await transitionOrder(orderId, 'READY_FOR_PICKUP', { actorType: 'SHOP' });
  await transitionOrder(orderId, 'DRIVER_ASSIGNED', { actorType: 'SYSTEM', driverId: driverProfileId });
  await prisma.driverProfile.update({ where: { id: driverProfileId }, data: { currentOrderId: orderId } });
}

async function newAssignedOrder() {
  const res = await placeOrder();
  expect(res.status).toBe(201);
  await readyAndAssign(res.body.order.id);
  return res.body.order as { id: string; code: string };
}

const pickup = (orderId: string, payload: string, token = driver.token) =>
  request(app).post(`/api/orders/${orderId}/pickup`).set(bearer(token)).send({ payload });

const deliver = (orderId: string, body: Record<string, string>, token = driver.token) =>
  request(app).post(`/api/orders/${orderId}/deliver`).set(bearer(token)).send(body);

const view = (orderId: string, token: string) =>
  request(app).get(`/api/orders/${orderId}`).set(bearer(token));

describe('1–6: إنشاء الطلب والمخزون ورقم الطلب', () => {
  it('1+2: ينشئ الطلب ويخصم الكمية من مخزون المحل', async () => {
    const res = await placeOrder(3);
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ subtotal: 3000, deliveryFee: FEE, total: 3000 + FEE });
    expect(await stockOf(productId)).toBe(7);
  });

  it('3: يرفض الكمية غير الكافية ولا يترك مخزونًا سالبًا', async () => {
    const res = await placeOrder(11);
    expect(res.status).toBe(409);
    expect(await stockOf(productId)).toBe(10);
    expect(await prisma.order.count()).toBe(0);
  });

  it('4: طلبات متزامنة على نفس المنتج لا تتجاوز المخزون', async () => {
    await prisma.shopProduct.update({ where: { id: productId }, data: { stock: 3 } });
    const results = await Promise.all(Array.from({ length: 6 }, () => placeOrder(1)));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(3);
    expect(results.filter((r) => r.status === 409).length).toBe(3);
    expect(await stockOf(productId)).toBe(0);
  });

  it('5: إعادة إرسال نفس الطلب لا تخصم مرتين', async () => {
    const key = 'checkout-retry-0001';
    const [a, b] = await Promise.all([placeOrder(2, key), placeOrder(2, key)]);
    const again = await placeOrder(2, key);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(a.body.order.id).toBe(b.body.order.id);
    expect(again.body.order.id).toBe(a.body.order.id);
    expect(await prisma.order.count()).toBe(1);
    expect(await stockOf(productId)).toBe(8);
  });

  it('6: رقم طلب ظاهر فريد وسهل القراءة، مستقل عن المعرّف الداخلي', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const r = await placeOrder(1);
      expect(r.body.order.code).toMatch(/^QF-[0-9A-HJ-NP-Z]{6}$/);
      expect(r.body.order.code).not.toBe(r.body.order.id);
      codes.add(r.body.order.code);
    }
    expect(codes.size).toBe(5);
  });
});

describe('7–13 + 22: QR واستلام الموصّل للطلب من المحل', () => {
  it('7: لكل طلب رمز QR خاص به لا يحمل بيانات حساسة', async () => {
    const a = await newAssignedOrder();
    const b = await newAssignedOrder().catch(() => null);
    const qrA = (await view(a.id, shop.token)).body.order.pickupQr as string;
    expect(parseQrPayload(qrA)?.kind).toBe('P');
    expect(qrA).not.toContain(a.id);
    expect(qrA).not.toContain(a.code);
    expect(qrA).toMatch(/^QOFFA:P:[a-f0-9]{64}$/); // رمز عشوائي فقط — لا هاتف ولا عنوان
    if (b) expect(await pickupQrFor(b.id)).not.toBe(qrA);
  });

  it('8+12+13: QR صحيح → يسجّل الموصّل والوقت والعملية وينقل الطلب إلى "في الطريق" ويُعلم الزبون', async () => {
    const order = await newAssignedOrder();
    const res = await pickup(order.id, await pickupQrFor(order.id));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, from: 'DRIVER_ASSIGNED', to: 'OUT_FOR_DELIVERY' });

    const db = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { scans: true, delivery: true },
    });
    expect(db.status).toBe('OUT_FOR_DELIVERY');
    expect(db.pickedUpAt).not.toBeNull();
    expect(db.outForDeliveryAt).not.toBeNull();
    expect(db.pickupVerifiedAt).not.toBeNull();
    expect(db.scans).toHaveLength(1);
    expect(db.scans[0]).toMatchObject({ stage: 'PICKUP', method: 'QR', driverId: driver.profile.id });

    const events = await prisma.orderStatusEvent.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.slice(-2).map((e) => e.toStatus)).toEqual(['PICKED_UP', 'OUT_FOR_DELIVERY']);
    expect(events.at(-2)!.actorId).toBe(driver.user.id);

    const note = await prisma.notification.findFirst({
      where: { userId: customer.user.id, orderId: order.id, type: 'ORDER_OUT_FOR_DELIVERY' },
    });
    expect(note?.title).toContain('طلبك في الطريق إليك');
  });

  it('9: QR خاطئ أو مزوّر أو لطلب آخر مرفوض ولا يغيّر الحالة', async () => {
    const order = await newAssignedOrder();
    const other = await placeOrder(1);
    for (const bad of ['hello', `QOFFA:P:${'a'.repeat(64)}`, order.code]) {
      const r = await pickup(order.id, bad);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('QR_INVALID');
    }
    const r2 = await pickup(order.id, await pickupQrFor(other.body.order.id));
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('QR_OTHER_ORDER');
    // رمز الزبون ليس رمز الاستلام
    const r3 = await pickup(order.id, await deliveryQrFor(order.id));
    expect(r3.status).toBe(409);
    expect(r3.body.error.code).toBe('QR_WRONG_STAGE');
    // بدون رمز إطلاقًا
    const r4 = await request(app).post(`/api/orders/${order.id}/pickup`).set(bearer(driver.token)).send({});
    expect(r4.status).toBe(400);

    const db = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(db.status).toBe('DRIVER_ASSIGNED');
    expect(await prisma.orderScan.count()).toBe(0);
  });

  it('10+22: QR مستخدم سابقًا مرفوض — الاستلام يحدث مرة واحدة فقط', async () => {
    const order = await newAssignedOrder();
    const qr = await pickupQrFor(order.id);
    expect((await pickup(order.id, qr)).status).toBe(200);
    const again = await pickup(order.id, qr);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('QR_ALREADY_USED');
    expect(await prisma.orderScan.count({ where: { orderId: order.id, stage: 'PICKUP' } })).toBe(1);
    expect(
      await prisma.orderStatusEvent.count({ where: { orderId: order.id, toStatus: 'PICKED_UP' } }),
    ).toBe(1);
  });

  it('22: مسحان متزامنان لنفس الرمز → استلام واحد فقط', async () => {
    const order = await newAssignedOrder();
    const qr = await pickupQrFor(order.id);
    const results = await Promise.all([pickup(order.id, qr), pickup(order.id, qr), pickup(order.id, qr)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await prisma.orderScan.count({ where: { orderId: order.id } })).toBe(1);
    expect(
      await prisma.orderStatusEvent.count({ where: { orderId: order.id, toStatus: 'OUT_FOR_DELIVERY' } }),
    ).toBe(1);
  });

  it('11: موصّل غير مخصص للطلب لا يستطيع استلامه بنفس QR', async () => {
    const order = await newAssignedOrder();
    const intruder = await createDriver();
    const r = await pickup(order.id, await pickupQrFor(order.id), intruder.token);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_ASSIGNED_DRIVER');
    // الزبون والمحل لا يستطيعان الاستلام
    expect((await pickup(order.id, await pickupQrFor(order.id), customer.token)).status).toBe(403);
    expect((await pickup(order.id, await pickupQrFor(order.id), shop.token)).status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'DRIVER_ASSIGNED',
    );
  });

  it('لا استلام قبل جاهزية الطلب وتعيين الموصّل', async () => {
    const res = await placeOrder();
    const orderId = res.body.order.id as string;
    await prisma.order.update({ where: { id: orderId }, data: { driverId: driver.profile.id } });
    const r = await pickup(orderId, await pickupQrFor(orderId));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('QR_WRONG_STAGE');
  });

  it('الموصّل لا يتلقى رمز الاستلام — يجب أن يمسحه من المحل', async () => {
    const order = await newAssignedOrder();
    const cur = await request(app).get('/api/drivers/me/current').set(bearer(driver.token));
    expect(cur.body.order.id).toBe(order.id);
    expect(JSON.stringify(cur.body)).not.toContain('QOFFA:');
    expect(JSON.stringify((await view(order.id, driver.token)).body)).not.toContain('QOFFA:');
  });
});

describe('14–20: رسوم التوصيل والحساب حسب الطرف', () => {
  it('18+19+20: حساب ما يدفعه الموصّل للمحل وما يقبضه من الزبون وأجرته', () => {
    expect(orderSettlement({ subtotal: 2000, deliveryFee: 200, total: 2200, platformFee: 30 })).toEqual({
      productsAmount: 2000,
      deliveryFee: 200,
      discount: 0,
      total: 2200,
      driverPaysShop: 2000,
      driverCollectsFromCustomer: 2200,
      platformFee: 30,
      driverKeeps: 170,
    });
  });

  it('14: الزبون يرى المنتجات والتوصيل والإجمالي ورمز التسليم', async () => {
    const order = await newAssignedOrder();
    const c = (await view(order.id, customer.token)).body.order;
    expect(c.subtotal).toBe(2000);
    expect(c.deliveryFee).toBe(200);
    expect(c.total).toBe(2200);
    expect(c.amounts).toEqual({ productsAmount: 2000, deliveryFee: 200, discount: 0, total: 2200 });
    expect(c.items[0]).toMatchObject({ quantity: 2, unitPrice: 1000, lineTotal: 2000 });
    expect(c.deliveryPin).toMatch(/^\d{4}$/);
    // لا يرى الزبون ما يخص التسوية الداخلية
    expect(c.settlement).toBeUndefined();
  });

  it('15: المحل لا يرى رسوم التوصيل ولا الإجمالي إطلاقًا', async () => {
    const order = await newAssignedOrder();
    const detail = await view(order.id, shop.token);
    const list = await request(app).get('/api/orders/shop').set(bearer(shop.token));
    for (const o of [detail.body.order, list.body.items[0]]) {
      expect(o.subtotal).toBe(2000);
      expect(o.productsAmount).toBe(2000);
      expect(o.amountFromDriver).toBe(2000);
      expect(o).not.toHaveProperty('deliveryFee');
      expect(o).not.toHaveProperty('total');
      expect(o).not.toHaveProperty('settlement');
      expect(o).not.toHaveProperty('deliveryPin');
      const text = JSON.stringify(o);
      expect(text).not.toContain('2200');
      expect(text).not.toMatch(/deliveryFee|driverCollects|driverKeeps|platformFee/);
    }
    // إشعار الطلب الجديد للمحل بقيمة المنتجات فقط
    const note = await prisma.notification.findFirstOrThrow({
      where: { userId: shop.owner.id, type: 'ORDER_CREATED' },
    });
    expect(note.body).toContain('2000');
    expect(note.body).not.toContain('2200');
    // والمحل لا يحصل على الفاتورة (فيها رسوم التوصيل)
    expect((await request(app).get(`/api/orders/${order.id}/invoice`).set(bearer(shop.token))).status).toBe(403);
    // بعد الاستلام: إشعار المحل بالمبلغ الذي يستلمه من الموصّل فقط
    await pickup(order.id, await pickupQrFor(order.id));
    const picked = await prisma.notification.findFirstOrThrow({
      where: { userId: shop.owner.id, type: 'ORDER_PICKED_UP' },
    });
    expect(picked.body).toContain('2000');
    expect(picked.body).not.toContain('2200');
    expect(picked.body).not.toContain('200 ');
  });

  it('16: الموصّل يرى ما يدفعه للمحل وما يقبضه من الزبون وأجرته — قبل وبعد المسح', async () => {
    const order = await newAssignedOrder();
    const expected = {
      productsAmount: 2000,
      deliveryFee: 200,
      total: 2200,
      driverPaysShop: 2000,
      driverCollectsFromCustomer: 2200,
      driverKeeps: 170,
      platformFee: 30,
    };
    const cur = await request(app).get('/api/drivers/me/current').set(bearer(driver.token));
    expect(cur.body.order.settlement).toMatchObject(expected);
    expect((await view(order.id, driver.token)).body.order.settlement).toMatchObject(expected);
    const r = await pickup(order.id, await pickupQrFor(order.id));
    expect(r.body.settlement).toMatchObject(expected);
  });

  it('17: الإدارة ترى كل المبالغ والأطراف والرموز والأوقات', async () => {
    const order = await newAssignedOrder();
    await pickup(order.id, await pickupQrFor(order.id));
    await deliver(order.id, { pin: await deliveryPinFor(order.id) });

    const d = (await view(order.id, admin.token)).body.order;
    expect(d.code).toBe(order.code);
    expect(d.settlement).toMatchObject({
      productsAmount: 2000,
      deliveryFee: 200,
      total: 2200,
      driverPaysShop: 2000,
      driverCollectsFromCustomer: 2200,
      driverKeeps: 170,
      platformFee: 30,
    });
    expect(parseQrPayload(d.pickupQr)?.kind).toBe('P');
    expect(d.customer.fullName).toBeTruthy();
    expect(d.shop.name).toBeTruthy();
    expect(d.driver.user.fullName).toBeTruthy();
    for (const t of ['createdAt', 'acceptedAt', 'readyAt', 'pickedUpAt', 'deliveredAt']) {
      expect(d[t], t).toBeTruthy();
    }
    expect(d.scans.map((s: { stage: string }) => s.stage)).toEqual(['PICKUP', 'DELIVERY']);

    const list = await request(app).get('/api/admin/orders').set(bearer(admin.token));
    expect(list.status).toBe(200);
    const row = list.body.items.find((o: { id: string }) => o.id === order.id);
    expect(row.settlement.driverPaysShop).toBe(2000);
    expect(row.settlement.driverCollectsFromCustomer).toBe(2200);
    expect(row.settlement.driverKeeps).toBe(170);
    expect(row.settlement.platformFee).toBe(30);
    expect(row.pickedUpAt).toBeTruthy();
  });
});

describe('21: الفاتورة', () => {
  it('تحتوي كل البيانات والمبالغ ورمز QR الطلب', async () => {
    const order = await newAssignedOrder();
    const res = await request(app).get(`/api/orders/${order.id}/invoice`).set(bearer(customer.token));
    expect(res.status).toBe(200);
    const inv = res.body.invoice;
    expect(inv.brand).toBe('QOFFA');
    expect(inv.title).toBe(`فاتورة الطلب ${order.code}`);
    expect(inv.shop.name).toBeTruthy();
    expect(inv.customer.fullName).toBeTruthy();
    expect(inv.date).toBeTruthy();
    expect(inv.items).toEqual([
      { name: 'زيت زيتون', unit: 'قطعة', quantity: 2, unitPrice: 1000, lineTotal: 2000 },
    ]);
    expect(inv.productsTotal).toBe(2000);
    expect(inv.deliveryFee).toBe(200);
    expect(inv.discount).toBe(0);
    expect(inv.total).toBe(2200);
    expect(inv.paymentNote).toContain('رسوم التوصيل');
    expect(inv.paymentNote).toContain('للموصّل');
    expect(parseQrPayload(inv.qr)).not.toBeNull();

    expect((await request(app).get(`/api/orders/${order.id}/invoice`).set(bearer(admin.token))).status).toBe(200);
    expect((await request(app).get(`/api/orders/${order.id}/invoice`).set(bearer(driver.token))).status).toBe(403);
    const stranger = await createCustomer();
    expect((await request(app).get(`/api/orders/${order.id}/invoice`).set(bearer(stranger.token))).status).toBe(403);
  });
});

describe('23: التسليم النهائي', () => {
  it('بـ PIN الزبون: DELIVERED مرة واحدة فقط مع التسوية', async () => {
    const order = await newAssignedOrder();
    await pickup(order.id, await pickupQrFor(order.id));
    const pin = await deliveryPinFor(order.id);

    const res = await deliver(order.id, { pin });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ to: 'DELIVERED', method: 'PIN' });
    const db = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(db.status).toBe('DELIVERED');
    expect(db.deliveredAt).not.toBeNull();
    expect(db.deliveryVerifiedAt).not.toBeNull();
    expect(await prisma.orderScan.count({ where: { orderId: order.id, stage: 'DELIVERY' } })).toBe(1);
    const profile = await prisma.driverProfile.findUniqueOrThrow({ where: { id: driver.profile.id } });
    expect(profile.currentOrderId).toBeNull();

    const again = await deliver(order.id, { pin });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_DELIVERED');
    expect(
      await prisma.orderStatusEvent.count({ where: { orderId: order.id, toStatus: 'DELIVERED' } }),
    ).toBe(1);
    // لا تسوية مزدوجة
    expect(await prisma.walletTransaction.count({ where: { orderId: order.id, type: 'ORDER_EARNING' } })).toBe(1);
    // الطلب المسلَّم لا يعود لحالة سابقة
    const admin2 = await createAdmin('ADMIN');
    const back = await request(app)
      .patch(`/api/admin/orders/${order.id}/status`)
      .set(bearer(admin2.token))
      .send({ status: 'OUT_FOR_DELIVERY' });
    expect([404, 409]).toContain(back.status);
  });

  it('بمسح QR الزبون', async () => {
    const order = await newAssignedOrder();
    await pickup(order.id, await pickupQrFor(order.id));
    const res = await deliver(order.id, { payload: await deliveryQrFor(order.id) });
    expect(res.status).toBe(200);
    expect(res.body.method).toBe('QR');
  });

  it('يرفض التسليم بلا تأكيد، أو بـ PIN خاطئ، ويقفل بعد محاولات كثيرة', async () => {
    const order = await newAssignedOrder();
    await pickup(order.id, await pickupQrFor(order.id));
    const pin = await deliveryPinFor(order.id);
    const wrong = pin === '0000' ? '1111' : '0000';

    expect((await deliver(order.id, {})).status).toBe(400);
    // رمز الاستلام ليس رمز التسليم
    const p = await deliver(order.id, { payload: await pickupQrFor(order.id) });
    expect(p.body.error.code).toBe('QR_WRONG_STAGE');

    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) {
      const r = await deliver(order.id, { pin: wrong });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('PIN_INVALID');
    }
    const locked = await deliver(order.id, { pin });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('PIN_LOCKED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OUT_FOR_DELIVERY');

    // مسح QR الزبون يبقى متاحًا
    expect((await deliver(order.id, { payload: await deliveryQrFor(order.id) })).status).toBe(200);
  });

  it('لا تسليم قبل الاستلام من المحل، ولا من موصّل آخر', async () => {
    const order = await newAssignedOrder();
    const early = await deliver(order.id, { pin: await deliveryPinFor(order.id) });
    expect(early.status).toBe(409);
    await pickup(order.id, await pickupQrFor(order.id));
    const intruder = await createDriver();
    const r = await deliver(order.id, { pin: await deliveryPinFor(order.id) }, intruder.token);
    expect(r.status).toBe(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OUT_FOR_DELIVERY');
  });
});

describe('حصة قفة الثابتة من رسوم التوصيل', () => {
  const setPlatformFee = (token: string, platformFee: number) =>
    request(app).put('/api/admin/delivery-pricing').set(bearer(token)).send({
      baseFee: FEE,
      baseKm: 15,
      perKmFee: 30,
      maxKm: 15,
      roadFactor: 1.3,
      platformFee,
    });

  it('القيمة الافتراضية 30 دج وتظهر في إعدادات الإدارة', async () => {
    await prisma.platformSetting.deleteMany({ where: { key: 'delivery.platformFee' } });
    const res = await request(app).get('/api/admin/delivery-pricing').set(bearer(admin.token));
    expect(res.body.pricing.platformFee).toBe(30);
  });

  it('تُثبَّت في الطلب عند إنشائه: توصيل 200 → قفة 30 والموصّل 170', async () => {
    const order = await newAssignedOrder();
    const db = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(db.platformFee).toBe(30);
    await pickup(order.id, await pickupQrFor(order.id));
    await deliver(order.id, { pin: await deliveryPinFor(order.id) });
    const done = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(done.driverEarning).toBe(170);
    const tx = await prisma.walletTransaction.findFirstOrThrow({ where: { orderId: order.id, type: 'DELIVERY_EARNING' } });
    expect(tx.amount).toBe(170);
  });

  it('تغيير الإدارة للقيمة لا يمسّ الطلبات القديمة', async () => {
    const superAdmin = await createAdmin('SUPER_ADMIN');
    const old = await newAssignedOrder(); // أُنشئ بـ 30
    const r = await setPlatformFee(superAdmin.token, 50);
    expect(r.status).toBe(200);
    expect(r.body.pricing.platformFee).toBe(50);

    const fresh = (await placeOrder(1)).body.order as { id: string };
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fresh.id } })).platformFee).toBe(50);

    await pickup(old.id, await pickupQrFor(old.id));
    await deliver(old.id, { pin: await deliveryPinFor(old.id) });
    const done = await prisma.order.findUniqueOrThrow({ where: { id: old.id } });
    expect(done.platformFee).toBe(30);
    expect(done.driverEarning).toBe(170);
  });

  it('المدير العادي لا يغيّر حصة قفة، والقيمة السالبة أو الكسرية مرفوضة', async () => {
    expect((await setPlatformFee(admin.token, 40)).status).toBe(403);
    const superAdmin = await createAdmin('SUPER_ADMIN');
    expect((await setPlatformFee(superAdmin.token, -1)).status).toBe(400);
    expect((await setPlatformFee(superAdmin.token, 12.5)).status).toBe(400);
  });

  it('لا تتجاوز حصة قفة رسوم التوصيل', async () => {
    const superAdmin = await createAdmin('SUPER_ADMIN');
    await setPlatformFee(superAdmin.token, 500);
    const o = (await placeOrder(1)).body.order as { id: string };
    const db = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(db.platformFee).toBe(FEE);
    expect(orderSettlement(db).driverKeeps).toBe(0);
  });

  it('الموصّل والإدارة يرون الحصة؛ الزبون يرى الإجمالي فقط؛ المحل لا يرى شيئًا منها', async () => {
    const order = await newAssignedOrder();
    const cur = await request(app).get('/api/drivers/me/current').set(bearer(driver.token));
    expect(cur.body.order.settlement).toMatchObject({ platformFee: 30, driverKeeps: 170, driverPaysShop: 2000 });
    expect((await view(order.id, admin.token)).body.order.settlement.platformFee).toBe(30);

    const c = (await view(order.id, customer.token)).body.order;
    expect(c.amounts).toEqual({ productsAmount: 2000, deliveryFee: 200, discount: 0, total: 2200 });
    expect(c).not.toHaveProperty('platformFee');

    const s = (await view(order.id, shop.token)).body.order;
    expect(s).not.toHaveProperty('platformFee');
    expect(s.amountFromDriver).toBe(2000);
    expect(JSON.stringify(s)).not.toMatch(/platformFee|driverKeeps/);

    const inv = (await request(app).get(`/api/orders/${order.id}/invoice`).set(bearer(customer.token))).body.invoice;
    expect(inv).toMatchObject({ productsTotal: 2000, deliveryFee: 200, total: 2200 });
  });
});
