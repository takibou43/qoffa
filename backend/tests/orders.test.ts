import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { transitionOrder } from '../src/modules/orders/orders.service.js';
import { acceptDeliveryOffer } from '../src/services/driverAssignment.js';
import {
  ALGIERS,
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createProduct,
  createShop,
  resetDb,
} from './helpers/factories.js';

const app = createApp();

let shop: Awaited<ReturnType<typeof createShop>>;
let otherShop: Awaited<ReturnType<typeof createShop>>;
let customer: Awaited<ReturnType<typeof createCustomer>>;
let otherCustomer: Awaited<ReturnType<typeof createCustomer>>;
let productA: Awaited<ReturnType<typeof createProduct>>;
let productB: Awaited<ReturnType<typeof createProduct>>;

beforeEach(async () => {
  await resetDb();
  shop = await createShop({ isOpen: true, deliveryFee: 150 });
  otherShop = await createShop({ isOpen: true });
  customer = await createCustomer();
  otherCustomer = await createCustomer();
  productA = await createProduct(shop.shop.id, { name: 'حليب', price: 120 });
  productB = await createProduct(shop.shop.id, { name: 'خبز', price: 25 });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const placeOrder = async (items = [{ productId: '', quantity: 2 }]) => {
  const body = {
    shopId: shop.shop.id,
    addressId: customer.address.id,
    items: items[0]!.productId
      ? items
      : [
          { productId: productA.id, quantity: 2 },
          { productId: productB.id, quantity: 4 },
        ],
  };
  const res = await request(app).post('/api/orders').set(bearer(customer.token)).send(body);
  return res;
};

describe('إنشاء الطلب', () => {
  it('ينشئ طلبًا ويحسب المبالغ من قاعدة البيانات', async () => {
    const res = await placeOrder();
    expect(res.status).toBe(201);

    const order = res.body.order;
    expect(order.status).toBe('PENDING');
    expect(order.code).toMatch(/^QF-[0-9A-Z]{6}$/);
    expect(order.subtotal).toBe(120 * 2 + 25 * 4); // 340
    expect(order.deliveryFee).toBe(150);
    expect(order.total).toBe(490);
    expect(order.items).toHaveLength(2);
    expect(order.distanceMeters).toBeGreaterThan(0);
  });

  it('يتجاهل أي سعر يرسله العميل ويستعمل سعر قاعدة البيانات', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        addressId: customer.address.id,
        items: [{ productId: productA.id, quantity: 1, unitPrice: 1, price: 1 }],
        subtotal: 1,
        total: 1,
        deliveryFee: 0,
      });
    expect(res.status).toBe(201);
    expect(res.body.order.subtotal).toBe(120);
    expect(res.body.order.total).toBe(270);
  });

  it('يدمج الكميات المكررة لنفس المنتج', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        addressId: customer.address.id,
        items: [
          { productId: productA.id, quantity: 1 },
          { productId: productA.id, quantity: 2 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order.items[0].quantity).toBe(3);
    expect(res.body.order.subtotal).toBe(360);
  });

  it('يرفض منتجًا من محل آخر', async () => {
    const foreign = await createProduct(otherShop.shop.id, { name: 'منتج الجار' });
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        addressId: customer.address.id,
        items: [{ productId: foreign.id, quantity: 1 }],
      });
    expect(res.status).toBe(400);
  });

  it('يرفض منتجًا غير متوفر أو مخفيًا', async () => {
    const unavailable = await createProduct(shop.shop.id, { isAvailable: false });
    const hidden = await createProduct(shop.shop.id, { isHidden: true });

    const r1 = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        addressId: customer.address.id,
        items: [{ productId: unavailable.id, quantity: 1 }],
      });
    expect(r1.status).toBe(409);

    const r2 = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        addressId: customer.address.id,
        items: [{ productId: hidden.id, quantity: 1 }],
      });
    expect(r2.status).toBe(400);
  });

  it('يرفض الطلب من محل مغلق', async () => {
    await prisma.shop.update({ where: { id: shop.shop.id }, data: { isOpen: false } });
    const res = await placeOrder();
    expect(res.status).toBe(409);
  });

  it('يرفض عنوان زبون آخر', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        addressId: otherCustomer.address.id,
        items: [{ productId: productA.id, quantity: 1 }],
      });
    expect(res.status).toBe(404);
  });

  it('يقبل عنوانًا يدويًا لمن لم يشارك موقعه المحفوظ', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        address: {
          addressLine: 'حي جديد، عمارة 9',
          city: 'الجزائر',
          latitude: 36.76,
          longitude: 3.06,
        },
        items: [{ productId: productA.id, quantity: 1 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.order.deliveryAddressLine).toBe('حي جديد، عمارة 9');
  });

  it('يرفض سلة فارغة أو بدون عنوان', async () => {
    const empty = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({ shopId: shop.shop.id, addressId: customer.address.id, items: [] });
    expect(empty.status).toBe(400);

    const noAddress = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({ shopId: shop.shop.id, items: [{ productId: productA.id, quantity: 1 }] });
    expect(noAddress.status).toBe(400);
  });

  it('يُشعر المحل والزبون عند إنشاء الطلب', async () => {
    const res = await placeOrder();
    const notifications = await prisma.notification.findMany({
      where: { orderId: res.body.order.id },
    });
    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.userId).sort()).toEqual(
      [shop.owner.id, customer.user.id].sort(),
    );
  });

  it('يمنع صاحب المحل والموصّل من إنشاء طلب', async () => {
    const driver = await createDriver();
    for (const token of [shop.token, driver.token]) {
      const res = await request(app)
        .post('/api/orders')
        .set(bearer(token))
        .send({
          shopId: shop.shop.id,
          address: { addressLine: 'x'.repeat(10), city: 'الجزائر', latitude: 36.7, longitude: 3 },
          items: [{ productId: productA.id, quantity: 1 }],
        });
      expect(res.status).toBe(403);
    }
  });
});

describe('تدفق حالات الطلب عبر الـAPI', () => {
  it('ينفّذ المسار الكامل من الطلب حتى التسليم عبر الـAPI', async () => {
    // موصّل متاح قريب حتى تعمل المطابقة التلقائية عند "جاهز"
    const driver = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });

    const created = await placeOrder();
    const orderId = created.body.order.id;

    expect(
      (await request(app).post(`/api/orders/${orderId}/accept`).set(bearer(shop.token))).status,
    ).toBe(200);
    expect(
      (await request(app).post(`/api/orders/${orderId}/prepare`).set(bearer(shop.token))).status,
    ).toBe(200);
    expect(
      (await request(app).post(`/api/orders/${orderId}/ready`).set(bearer(shop.token))).status,
    ).toBe(200);

    const afterReady = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterReady.status).toBe('READY_FOR_PICKUP');
    expect(afterReady.acceptedAt).not.toBeNull();
    expect(afterReady.preparingAt).not.toBeNull();
    expect(afterReady.readyAt).not.toBeNull();

    // "جاهز" يطلق عرضًا تلقائيًا على أقرب موصّل متاح
    const offer = await prisma.deliveryOffer.findFirstOrThrow({
      where: { orderId, status: 'PENDING' },
    });
    expect(offer.driverId).toBe(driver.profile.id);

    expect(
      (await request(app)
        .post(`/api/drivers/offers/${orderId}/accept`)
        .set(bearer(driver.token))).status,
    ).toBe(200);

    for (const path of ['pickup', 'out-for-delivery', 'deliver']) {
      expect(
        (await request(app).post(`/api/orders/${orderId}/${path}`).set(bearer(driver.token)))
          .status,
        path,
      ).toBe(200);
    }

    const delivered = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.closedAt).not.toBeNull();
  });

  it('يمنع تخطي المراحل عبر الـAPI', async () => {
    const created = await placeOrder();
    const orderId = created.body.order.id;

    // "جاهز" قبل القبول
    const early = await request(app)
      .post(`/api/orders/${orderId}/ready`)
      .set(bearer(shop.token));
    expect(early.status).toBe(409);

    // "بدء التحضير" قبل القبول
    const prepare = await request(app)
      .post(`/api/orders/${orderId}/prepare`)
      .set(bearer(shop.token));
    expect(prepare.status).toBe(409);

    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(unchanged.status).toBe('PENDING');
  });

  it('يمنع محلًا آخر من التصرّف في الطلب', async () => {
    const created = await placeOrder();
    const orderId = created.body.order.id;

    const res = await request(app)
      .post(`/api/orders/${orderId}/accept`)
      .set(bearer(otherShop.token));
    expect(res.status).toBe(404);

    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(unchanged.status).toBe('PENDING');
  });

  it('يسجّل كل انتقال في الخط الزمني', async () => {
    const created = await placeOrder();
    const orderId = created.body.order.id;
    await request(app).post(`/api/orders/${orderId}/accept`).set(bearer(shop.token));
    await request(app).post(`/api/orders/${orderId}/prepare`).set(bearer(shop.token));

    const timeline = await request(app)
      .get(`/api/orders/${orderId}/timeline`)
      .set(bearer(customer.token));
    expect(timeline.status).toBe(200);
    expect(timeline.body.items.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'PENDING',
      'SHOP_ACCEPTED',
      'PREPARING',
    ]);
  });

  it('الرفض يتطلب سببًا ويحفظه', async () => {
    const created = await placeOrder();
    const orderId = created.body.order.id;

    const noReason = await request(app)
      .post(`/api/orders/${orderId}/reject`)
      .set(bearer(shop.token))
      .send({});
    expect(noReason.status).toBe(400);

    const rejected = await request(app)
      .post(`/api/orders/${orderId}/reject`)
      .set(bearer(shop.token))
      .send({ reason: 'المنتجات غير متوفرة' });
    expect(rejected.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('REJECTED');
    expect(order.rejectionReason).toBe('المنتجات غير متوفرة');
    expect(order.closedAt).not.toBeNull();
  });
});

describe('قواعد الإلغاء', () => {
  it('الزبون يلغي وهو PENDING', async () => {
    const created = await placeOrder();
    const res = await request(app)
      .post(`/api/orders/${created.body.order.id}/cancel`)
      .set(bearer(customer.token))
      .send({ reason: 'غيّرت رأيي' });
    expect(res.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.body.order.id } });
    expect(order.status).toBe('CANCELLED');
    expect(order.cancelledBy).toBe('CUSTOMER');
    expect(order.cancelReason).toBe('غيّرت رأيي');
  });

  it('الزبون يلغي بعد قبول المحل وقبل التحضير', async () => {
    const created = await placeOrder();
    const orderId = created.body.order.id;
    await request(app).post(`/api/orders/${orderId}/accept`).set(bearer(shop.token));

    const res = await request(app)
      .post(`/api/orders/${orderId}/cancel`)
      .set(bearer(customer.token))
      .send({});
    expect(res.status).toBe(200);
  });

  it('الزبون لا يستطيع الإلغاء بعد بدء التحضير', async () => {
    const created = await placeOrder();
    const orderId = created.body.order.id;
    await request(app).post(`/api/orders/${orderId}/accept`).set(bearer(shop.token));
    await request(app).post(`/api/orders/${orderId}/prepare`).set(bearer(shop.token));

    const res = await request(app)
      .post(`/api/orders/${orderId}/cancel`)
      .set(bearer(customer.token))
      .send({});
    expect(res.status).toBe(403);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PREPARING');
  });

  it('الزبون لا يستطيع إلغاء طلب زبون آخر', async () => {
    const created = await placeOrder();
    const res = await request(app)
      .post(`/api/orders/${created.body.order.id}/cancel`)
      .set(bearer(otherCustomer.token))
      .send({});
    expect(res.status).toBe(404);
  });

  it('لا يمكن إلغاء طلب مُسلَّم', async () => {
    const created = await placeOrder();
    const orderId = created.body.order.id;
    await prisma.order.update({ where: { id: orderId }, data: { status: 'DELIVERED' } });

    const res = await request(app)
      .post(`/api/orders/${orderId}/cancel`)
      .set(bearer(customer.token))
      .send({});
    expect(res.status).toBe(409);
  });
});

describe('صلاحيات قراءة الطلبات', () => {
  it('الزبون يرى طلباته فقط', async () => {
    const created = await placeOrder();
    const orderId = created.body.order.id;

    expect(
      (await request(app).get(`/api/orders/${orderId}`).set(bearer(customer.token))).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/orders/${orderId}`).set(bearer(otherCustomer.token))).status,
    ).toBe(403);
  });

  it('محل آخر لا يرى الطلب', async () => {
    const created = await placeOrder();
    const res = await request(app)
      .get(`/api/orders/${created.body.order.id}`)
      .set(bearer(otherShop.token));
    expect(res.status).toBe(403);
  });

  it('الإدارة ترى أي طلب', async () => {
    const created = await placeOrder();
    const admin = await createAdmin();
    const res = await request(app)
      .get(`/api/orders/${created.body.order.id}`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);
  });

  it('قائمة طلبات المحل تعرض طلبات محله فقط', async () => {
    await placeOrder();
    const res = await request(app).get('/api/orders/shop?limit=50').set(bearer(shop.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);

    const empty = await request(app).get('/api/orders/shop?limit=50').set(bearer(otherShop.token));
    expect(empty.body.items).toHaveLength(0);
  });

  it('يصفّي طلبات المحل بالمجموعات', async () => {
    const created = await placeOrder();
    await request(app).post(`/api/orders/${created.body.order.id}/accept`).set(bearer(shop.token));

    const newOnes = await request(app)
      .get('/api/orders/shop?bucket=new')
      .set(bearer(shop.token));
    expect(newOnes.body.items).toHaveLength(0);

    const active = await request(app)
      .get('/api/orders/shop?bucket=active')
      .set(bearer(shop.token));
    expect(active.body.items).toHaveLength(1);
  });
});

describe('التسوية المالية عند التسليم', () => {
  it('يسجّل العمولة واستحقاق المحل والموصّل', async () => {
    const driver = await createDriver({ lat: ALGIERS.lat + 0.001, lon: ALGIERS.lon });
    const created = await placeOrder(); // subtotal 340، توصيل 150
    const orderId = created.body.order.id;

    await request(app).post(`/api/orders/${orderId}/accept`).set(bearer(shop.token));
    await request(app).post(`/api/orders/${orderId}/prepare`).set(bearer(shop.token));
    await request(app).post(`/api/orders/${orderId}/ready`).set(bearer(shop.token));
    await acceptDeliveryOffer(driver.profile.id, orderId);
    await transitionOrder(orderId, 'PICKED_UP', { actorType: 'DRIVER' });
    await transitionOrder(orderId, 'OUT_FOR_DELIVERY', { actorType: 'DRIVER' });
    await transitionOrder(orderId, 'DELIVERED', { actorType: 'DRIVER' });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.commissionAmount).toBe(34); // 10% من 340
    expect(order.driverEarning).toBe(120); // 80% من 150

    const shopWallet = await prisma.wallet.findUniqueOrThrow({
      where: { shopId: shop.shop.id },
    });
    expect(shopWallet.balance).toBe(340 - 34);

    const driverWallet = await prisma.wallet.findUniqueOrThrow({
      where: { driverId: driver.profile.id },
    });
    expect(driverWallet.balance).toBe(120);

    const txs = await prisma.walletTransaction.findMany({ where: { orderId } });
    expect(txs.map((t) => t.type).sort()).toEqual(
      ['DELIVERY_EARNING', 'ORDER_EARNING', 'PLATFORM_COMMISSION'].sort(),
    );
    // كل المبالغ أعداد صحيحة
    expect(txs.every((t) => Number.isInteger(t.amount))).toBe(true);
  });
});
