import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// تحكّم في مولّد رقم الطلب لاختبار التصادم؛ بلا قيمة في الطابور يعمل المولّد الحقيقي
const codeQueue = vi.hoisted(() => [] as string[]);
vi.mock('../src/lib/code.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/code.js')>();
  return { ...actual, generateOrderCode: () => codeQueue.shift() ?? actual.generateOrderCode() };
});

import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { transitionOrder } from '../src/modules/orders/orders.service.js';
import { parseQrPayload } from '../src/services/orderQr.js';
import {
  bearer,
  createCustomer,
  createDriver,
  createProduct,
  createShop,
  resetDb,
} from './helpers/factories.js';

const app = createApp();

let shop: Awaited<ReturnType<typeof createShop>>;
let customer: Awaited<ReturnType<typeof createCustomer>>;
let driver: Awaited<ReturnType<typeof createDriver>>;
let productId: string;

beforeEach(async () => {
  codeQueue.length = 0;
  await resetDb();
  shop = await createShop({ isOpen: true });
  customer = await createCustomer();
  driver = await createDriver();
  productId = (await createProduct(shop.shop.id, { name: 'خبز', price: 30 })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function placeOrder(c = customer) {
  const res = await request(app)
    .post('/api/orders')
    .set(bearer(c.token))
    .send({ shopId: shop.shop.id, addressId: c.address.id, items: [{ productId, quantity: 2 }] });
  expect(res.status).toBe(201);
  return res.body.order as { id: string; code: string };
}

/** يوصل الطلب إلى DRIVER_ASSIGNED مع موصّل معيّن عبر آلة الحالات الحقيقية */
async function assign(orderId: string, driverProfileId = driver.profile.id) {
  await transitionOrder(orderId, 'SHOP_ACCEPTED', { actorType: 'SHOP' });
  await transitionOrder(orderId, 'PREPARING', { actorType: 'SHOP' });
  await transitionOrder(orderId, 'READY_FOR_PICKUP', { actorType: 'SHOP' });
  await transitionOrder(orderId, 'DRIVER_ASSIGNED', {
    actorType: 'SYSTEM',
    driverId: driverProfileId,
  });
}

const getOrder = (orderId: string, token: string) =>
  request(app).get(`/api/orders/${orderId}`).set(bearer(token));

const verify = (orderId: string, payload: string, token = driver.token) =>
  request(app).post(`/api/orders/${orderId}/verify-qr`).set(bearer(token)).send({ payload });

describe('رقم الطلب orderCode', () => {
  it('يُولَّد رقم قصير سهل القراءة لكل طلب جديد', async () => {
    const order = await placeOrder();
    expect(order.code).toMatch(/^QF-[0-9A-HJ-NP-Z]{6}$/);
    // المعرّف الداخلي يبقى كما هو ومختلفًا عن الرقم الظاهر
    expect(order.id).not.toBe(order.code);
  });

  it('لا يتكرر رقم الطلب عبر عدة طلبات', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 12; i++) codes.add((await placeOrder()).code);
    expect(codes.size).toBe(12);
  });

  it('عند تصادم الرقم يُعاد التوليد تلقائيًا دون خصم مزدوج', async () => {
    const tracked = await createProduct(shop.shop.id, { stock: 10 });
    productId = tracked.id;
    const first = await placeOrder();
    codeQueue.push(first.code); // المحاولة الأولى ستصطدم بالقيد الفريد
    const second = await placeOrder();
    expect(second.code).not.toBe(first.code);
    expect(await prisma.order.count()).toBe(2);
    const stock = await prisma.shopProduct.findUniqueOrThrow({ where: { id: tracked.id } });
    expect(stock.stock).toBe(6); // 2 + 2 فقط، المعاملة الفاشلة أُرجعت بالكامل
  });
});

describe('ظهور QR حسب الطرف', () => {
  it('الزبون يرى رمز التسليم فقط، والمحل والموصّل يريان رمز الاستلام فقط', async () => {
    const order = await placeOrder();
    await assign(order.id);

    const c = await getOrder(order.id, customer.token);
    expect(c.status).toBe(200);
    expect(parseQrPayload(c.body.order.deliveryQr)?.kind).toBe('D');
    expect(c.body.order.pickupQr).toBeNull();

    const s = await getOrder(order.id, shop.token);
    expect(parseQrPayload(s.body.order.pickupQr)?.kind).toBe('P');
    expect(s.body.order.deliveryQr ?? null).toBeNull();

    // الموصّل لا يحمل أي رمز: يجب أن يمسح رمز الاستلام من المحل
    const d = await getOrder(order.id, driver.token);
    expect(d.body.order.pickupQr).toBeNull();
    expect(d.body.order.deliveryQr).toBeNull();

    const cur = await request(app).get('/api/drivers/me/current').set(bearer(driver.token));
    expect(cur.body.order.pickupQr).toBeUndefined();
    expect(cur.body.order.deliveryQr).toBeUndefined();
    // لا تُكشف الرموز الخام في أي حقل
    expect(JSON.stringify(cur.body)).not.toContain('pickupToken');
    expect(JSON.stringify(c.body)).not.toContain('deliveryToken');
  });

  it('الـQR لا يحمل بيانات الطلب — رمز عشوائي فقط', async () => {
    const order = await placeOrder();
    const c = await getOrder(order.id, customer.token);
    const payload = c.body.order.deliveryQr as string;
    expect(payload).toMatch(/^QOFFA:D:[a-f0-9]{64}$/);
    expect(payload).not.toContain(order.id);
    expect(payload).not.toContain(order.code);
  });

  it('لا يظهر QR بعد انتهاء الطلب', async () => {
    const order = await placeOrder();
    await transitionOrder(order.id, 'CANCELLED', { actorType: 'CUSTOMER' });
    const c = await getOrder(order.id, customer.token);
    expect(c.body.order.deliveryQr).toBeNull();
  });
});

describe('التحقق من QR عند الاستلام والتسليم', () => {
  async function tokensFor(orderId: string) {
    const [c, s] = await Promise.all([getOrder(orderId, customer.token), getOrder(orderId, shop.token)]);
    return { pickup: s.body.order.pickupQr as string, delivery: c.body.order.deliveryQr as string };
  }

  it('المسار الكامل: رمز الاستلام في المحل ثم رمز الزبون عند التسليم — دون تغيير الحالة', async () => {
    const order = await placeOrder();
    await assign(order.id);
    const qr = await tokensFor(order.id);

    const p = await verify(order.id, qr.pickup);
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ verified: true, stage: 'PICKUP', alreadyVerified: false });
    expect(p.body.order).toMatchObject({ id: order.id, code: order.code, status: 'DRIVER_ASSIGNED', itemsCount: 2 });
    // لا بيانات حساسة في رد التحقق
    expect(JSON.stringify(p.body)).not.toMatch(/Phone|Address|Latitude/);

    // المسح وحده لا يغيّر الحالة
    let db = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(db.status).toBe('DRIVER_ASSIGNED');
    expect(db.pickupVerifiedAt).not.toBeNull();

    // رمز التسليم قبل الاستلام مرفوض
    const early = await verify(order.id, qr.delivery);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('QR_WRONG_STAGE');

    const pick = await request(app)
      .post(`/api/orders/${order.id}/pickup`)
      .set(bearer(driver.token))
      .send({ payload: qr.pickup });
    expect(pick.status).toBe(200);

    // رمز الاستلام بعد الاستلام مرفوض
    const late = await verify(order.id, qr.pickup);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('QR_WRONG_STAGE');

    const dv = await verify(order.id, qr.delivery);
    expect(dv.status).toBe(200);
    expect(dv.body.stage).toBe('DELIVERY');
    db = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(db.status).toBe('OUT_FOR_DELIVERY');
    expect(db.deliveryVerifiedAt).not.toBeNull();

    // تكرار المسح آمن: لا يغيّر شيئًا ويعيد نفس وقت التحقق الأول
    const again = await verify(order.id, qr.delivery);
    expect(again.status).toBe(200);
    expect(again.body.alreadyVerified).toBe(true);
    expect(new Date(again.body.verifiedAt).getTime()).toBe(db.deliveryVerifiedAt!.getTime());
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('OUT_FOR_DELIVERY');
    expect(await prisma.orderStatusEvent.count({ where: { orderId: order.id } })).toBe(7);
  });

  it('يرفض QR لطلب آخر', async () => {
    const mine = await placeOrder();
    const other = await placeOrder();
    await assign(mine.id);
    const otherQr = (await getOrder(other.id, customer.token)).body.order.deliveryQr as string;
    const otherPickup = (await getOrder(other.id, shop.token)).body.order.pickupQr as string;

    const r1 = await verify(mine.id, otherPickup);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe('QR_OTHER_ORDER');
    // لا نكشف رقم الطلب الآخر
    expect(r1.body.error.message).not.toContain(other.code);

    await request(app)
      .post(`/api/orders/${mine.id}/pickup`)
      .set(bearer(driver.token))
      .send({ payload: (await getOrder(mine.id, shop.token)).body.order.pickupQr })
      .expect(200);
    const r2 = await verify(mine.id, otherQr);
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('QR_OTHER_ORDER');
    const db = await prisma.order.findUniqueOrThrow({ where: { id: mine.id } });
    expect(db.deliveryVerifiedAt).toBeNull();
  });

  it('يرفض QR غير صالح أو مزوّر', async () => {
    const order = await placeOrder();
    await assign(order.id);
    for (const bad of ['hello', 'QOFFA:D:123', `QOFFA:X:${'a'.repeat(64)}`, order.code, order.id]) {
      const r = await verify(order.id, bad);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('QR_INVALID');
    }
    const forged = await verify(order.id, `QOFFA:P:${'a'.repeat(64)}`);
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('QR_INVALID');
    const empty = await verify(order.id, '');
    expect(empty.status).toBe(400);
  });

  it('صلاحيات: موصّل آخر، الزبون، والمحل لا يستطيعون التحقق', async () => {
    const order = await placeOrder();
    await assign(order.id);
    const qr = await tokensFor(order.id);

    const stranger = await createDriver();
    const r = await verify(order.id, qr.pickup, stranger.token);
    expect(r.status).toBe(404);
    // الموصّل الغريب لا يرى الطلب ولا رمزه
    expect((await getOrder(order.id, stranger.token)).status).toBe(403);

    expect((await verify(order.id, qr.pickup, customer.token)).status).toBe(403);
    expect((await verify(order.id, qr.pickup, shop.token)).status).toBe(403);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      pickupVerifiedAt: null,
    });
  });

  it('يرفض QR قديمًا بعد انتهاء الطلب ولا يسمح بتسليم مزدوج', async () => {
    const order = await placeOrder();
    await assign(order.id);
    const qr = await tokensFor(order.id);
    await request(app).post(`/api/orders/${order.id}/pickup`).set(bearer(driver.token)).send({ payload: qr.pickup }).expect(200);
    await request(app).post(`/api/orders/${order.id}/deliver`).set(bearer(driver.token)).send({ payload: qr.delivery }).expect(200);

    const r = await verify(order.id, qr.delivery);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('QR_EXPIRED');

    // لا تسليم مرتين
    const twice = await request(app).post(`/api/orders/${order.id}/deliver`).set(bearer(driver.token)).send({ payload: qr.delivery });
    expect(twice.status).toBe(409);
    expect(await prisma.orderStatusEvent.count({ where: { orderId: order.id, toStatus: 'DELIVERED' } })).toBe(1);
  });
});
