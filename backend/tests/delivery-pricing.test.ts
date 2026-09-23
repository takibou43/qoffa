import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  computeDeliveryFee,
  defaultPricingConfig,
  loadPricingConfig,
  type DeliveryPricingConfig,
} from '../src/services/deliveryPricing.js';
import {
  bearer,
  createAdmin,
  createCustomer,
  createProduct,
  createShop,
  resetDb,
} from './helpers/factories.js';

const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

const CONFIG: DeliveryPricingConfig = {
  baseFee: 100,
  baseKm: 1,
  perKmFee: 40,
  maxKm: 10,
  roadFactor: 1.5,
  platformFee: 30,
};

describe('computeDeliveryFee (دالة نقية)', () => {
  it('يعتمد الرسم الأساسي داخل المسافة المشمولة', () => {
    // 600م × 1.5 = 0.9 كم ≤ 1 كم
    expect(computeDeliveryFee(CONFIG, 600)).toEqual({
      distanceKm: 0.9,
      fee: 100,
      withinRange: true,
    });
  });

  it('يضيف سعر كل كيلومتر إضافي أو جزء منه', () => {
    // 2000م × 1.5 = 3.0 كم → 2 كم إضافية
    expect(computeDeliveryFee(CONFIG, 2000).fee).toBe(100 + 2 * 40);
    // 2100م × 1.5 = 3.15 → 3.2 كم بعد التقريب → 2.2 إضافية → 3 كم
    const q = computeDeliveryFee(CONFIG, 2100);
    expect(q.distanceKm).toBe(3.2);
    expect(q.fee).toBe(100 + 3 * 40);
  });

  it('يرفض ما تجاوز الحد الأقصى ويعيد مبلغًا صحيحًا دائمًا', () => {
    const far = computeDeliveryFee(CONFIG, 8000); // 12 كم
    expect(far.withinRange).toBe(false);
    expect(Number.isInteger(far.fee)).toBe(true);
  });
});

describe('تسعير التوصيل عبر الـAPI', () => {
  let shop: Awaited<ReturnType<typeof createShop>>;
  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let product: Awaited<ReturnType<typeof createProduct>>;
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
  let admin: Awaited<ReturnType<typeof createAdmin>>;

  beforeEach(async () => {
    await resetDb();
    shop = await createShop({ isOpen: true });
    customer = await createCustomer();
    product = await createProduct(shop.shop.id, { price: 100 });
    superAdmin = await createAdmin('SUPER_ADMIN');
    admin = await createAdmin('ADMIN');
  });

  const setPricing = (token: string, body: Record<string, number>) =>
    request(app).put('/api/admin/delivery-pricing').set(bearer(token)).send(body);

  const order = () =>
    request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        addressId: customer.address.id,
        items: [{ productId: product.id, quantity: 1 }],
      });

  it('يستعمل القيم الافتراضية قبل أن تضبط الإدارة شيئًا', async () => {
    const res = await request(app).get('/api/admin/delivery-pricing').set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.pricing).toEqual(defaultPricingConfig());
  });

  it('مالك المنصة يضبط الأسعار ويُسجَّل التغيير', async () => {
    const res = await setPricing(superAdmin.token, CONFIG as never);
    expect(res.status).toBe(200);
    expect(res.body.pricing).toEqual(CONFIG);
    expect(await loadPricingConfig()).toEqual(CONFIG);

    const log = await prisma.adminAuditLog.findFirst({ where: { action: 'SETTING_CHANGED' } });
    expect(log?.targetId).toBe('delivery.pricing');
  });

  it('المدير العادي والأدوار الأخرى لا يعدّلون الأسعار', async () => {
    expect((await setPricing(admin.token, CONFIG as never)).status).toBe(403);
    expect((await setPricing(shop.token, CONFIG as never)).status).toBe(403);
    expect((await setPricing(customer.token, CONFIG as never)).status).toBe(403);
  });

  it('يرفض قيمًا غير منطقية', async () => {
    expect((await setPricing(superAdmin.token, { ...CONFIG, baseFee: -5 })).status).toBe(400);
    expect((await setPricing(superAdmin.token, { ...CONFIG, roadFactor: 0.5 })).status).toBe(400);
    expect((await setPricing(superAdmin.token, { ...CONFIG, perKmFee: 12.5 })).status).toBe(400);
  });

  it('الطلب يُسعَّر بمعاملات الإدارة والمسافة', async () => {
    // المحل والعنوان يبعدان ≈ 1.43 كم مستقيمة
    await setPricing(superAdmin.token, {
      baseFee: 100,
      baseKm: 0.5,
      perKmFee: 40,
      maxKm: 15,
      roadFactor: 1.3,
    });
    const res = await order();
    expect(res.status).toBe(201);
    // 1.43 × 1.3 ≈ 1.9 كم → 1.4 إضافية → 2 كم × 40 = 80
    expect(res.body.order.deliveryFee).toBe(180);
    expect(res.body.order.total).toBe(100 + 180);
  });

  it('يرفض الطلب خارج نطاق التوصيل', async () => {
    await setPricing(superAdmin.token, {
      baseFee: 100,
      baseKm: 0.5,
      perKmFee: 40,
      maxKm: 1,
      roadFactor: 1.3,
    });
    const res = await order();
    expect(res.status).toBe(409);
    expect(await prisma.order.count()).toBe(0);
  });

  it('endpoint التسعير التقديري يطابق حساب الطلب', async () => {
    await setPricing(superAdmin.token, {
      baseFee: 100,
      baseKm: 0.5,
      perKmFee: 40,
      maxKm: 15,
      roadFactor: 1.3,
    });
    const quote = await request(app)
      .get('/api/orders/quote')
      .query({
        shopId: shop.shop.id,
        lat: customer.address.latitude,
        lon: customer.address.longitude,
      })
      .set(bearer(customer.token));
    expect(quote.status).toBe(200);
    expect(quote.body.quote.fee).toBe(180);
    expect(quote.body.quote.withinRange).toBe(true);

    const created = await order();
    expect(created.body.order.deliveryFee).toBe(quote.body.quote.fee);
  });

  it('صاحب المحل لا يستطيع تحديد رسم التوصيل', async () => {
    const before = await prisma.shop.findUniqueOrThrow({ where: { id: shop.shop.id } });
    const res = await request(app)
      .patch('/api/shops/me')
      .set(bearer(shop.token))
      .send({ name: 'اسم جديد', deliveryFee: 1 });
    expect(res.status).toBe(200);

    const after = await prisma.shop.findUniqueOrThrow({ where: { id: shop.shop.id } });
    expect(after.deliveryFee).toBe(before.deliveryFee);

    // والطلب لا يتأثر بقيمة العمود القديم
    const created = await order();
    expect(created.body.order.deliveryFee).toBe(defaultPricingConfig().baseFee);
  });

  it('لا يثق بأي رسم يرسله العميل', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        addressId: customer.address.id,
        items: [{ productId: product.id, quantity: 1 }],
        deliveryFee: 0,
      });
    expect(res.status).toBe(201);
    expect(res.body.order.deliveryFee).toBe(defaultPricingConfig().baseFee);
  });
});
