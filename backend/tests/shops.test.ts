import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  ALGIERS,
  bearer,
  createCustomer,
  createDriver,
  createProduct,
  createShop,
  resetDb,
} from './helpers/factories.js';

const app = createApp();

let nearShop: Awaited<ReturnType<typeof createShop>>;
let farShop: Awaited<ReturnType<typeof createShop>>;
let pendingShop: Awaited<ReturnType<typeof createShop>>;
let customer: Awaited<ReturnType<typeof createCustomer>>;

beforeAll(async () => {
  await resetDb();

  nearShop = await createShop({ isOpen: true });
  farShop = await createShop({ isOpen: false });
  pendingShop = await createShop({ status: 'PENDING' });
  customer = await createCustomer();

  // نُبعد المحل الثاني ~9 كم شمالًا
  await prisma.shop.update({
    where: { id: farShop.shop.id },
    data: { latitude: ALGIERS.lat + 0.08, name: 'محل بعيد' },
  });

  await createProduct(nearShop.shop.id, { name: 'حليب 1 لتر', price: 120 });
  await createProduct(nearShop.shop.id, { name: 'خبز', price: 25, isAvailable: false });
  await createProduct(nearShop.shop.id, { name: 'منتج مخفي', price: 999, isHidden: true });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('اكتشاف المحلات', () => {
  it('يعرض المحلات المعتمدة فقط ولا يعرض المحل قيد المراجعة', async () => {
    const res = await request(app).get('/api/shops?limit=50');
    expect(res.status).toBe(200);
    const ids = res.body.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(nearShop.shop.id);
    expect(ids).not.toContain(pendingShop.shop.id);
  });

  it('يحسب المسافة ويرتّب المفتوح أولًا عند توفر الموقع', async () => {
    const res = await request(app).get(
      `/api/shops?lat=${ALGIERS.lat}&lon=${ALGIERS.lon}&radiusKm=20&limit=50`,
    );
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ id: string; distanceMeters: number; isOpen: boolean }>;
    expect(items[0]!.id).toBe(nearShop.shop.id);
    expect(items[0]!.distanceMeters).toBeLessThan(500);
    expect(items.find((s) => s.id === farShop.shop.id)!.distanceMeters).toBeGreaterThan(5000);
  });

  it('يستبعد المحلات خارج نصف القطر', async () => {
    const res = await request(app).get(
      `/api/shops?lat=${ALGIERS.lat}&lon=${ALGIERS.lon}&radiusKm=2&limit=50`,
    );
    const ids = res.body.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(nearShop.shop.id);
    expect(ids).not.toContain(farShop.shop.id);
  });

  it('يدعم openOnly والبحث بالاسم', async () => {
    const open = await request(app).get('/api/shops?openOnly=true&limit=50');
    const openIds = open.body.items.map((s: { id: string }) => s.id);
    expect(openIds).not.toContain(farShop.shop.id);

    const search = await request(app).get('/api/shops?q=بعيد&limit=50');
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].id).toBe(farShop.shop.id);
  });

  it('يعيد isOpenNow الذي يجمع بين مفتاح المالك وساعات العمل', async () => {
    // نضبط ساعات عمل انتهت بالتأكيد
    await prisma.shop.update({
      where: { id: nearShop.shop.id },
      data: { isOpen: true, openingTime: '00:00', closingTime: '00:01' },
    });

    const res = await request(app).get(`/api/shops/${nearShop.shop.id}`);
    expect(res.status).toBe(200);
    expect(res.body.shop.isOpen).toBe(true);
    expect(res.body.shop.isOpenNow).toBe(false);

    await prisma.shop.update({
      where: { id: nearShop.shop.id },
      data: { openingTime: '00:00', closingTime: '00:00' },
    });
    const open = await request(app).get(`/api/shops/${nearShop.shop.id}`);
    expect(open.body.shop.isOpenNow).toBe(true);
  });

  it('يرفض الوصول إلى محل غير معتمد', async () => {
    const res = await request(app).get(`/api/shops/${pendingShop.shop.id}`);
    expect(res.status).toBe(404);
  });

  it('لا يعرض المنتجات المخفية للزبون', async () => {
    const res = await request(app).get(`/api/shops/${nearShop.shop.id}/products?limit=50`);
    expect(res.status).toBe(200);
    const names = res.body.items.map((p: { name: string }) => p.name);
    expect(names).toContain('حليب 1 لتر');
    expect(names).toContain('خبز');
    expect(names).not.toContain('منتج مخفي');
  });

  it('يرتّب المنتجات المتوفرة أولًا', async () => {
    const res = await request(app).get(`/api/shops/${nearShop.shop.id}/products?limit=50`);
    const items = res.body.items as Array<{ isAvailable: boolean }>;
    expect(items[0]!.isAvailable).toBe(true);
    expect(items[items.length - 1]!.isAvailable).toBe(false);
  });
});

describe('صلاحيات لوحة المحل', () => {
  it('يمنع الزبون والموصّل من مسارات المحل', async () => {
    const driver = await createDriver();
    expect((await request(app).get('/api/shops/me').set(bearer(customer.token))).status).toBe(403);
    expect((await request(app).get('/api/shops/me').set(bearer(driver.token))).status).toBe(403);
    expect((await request(app).get('/api/products').set(bearer(customer.token))).status).toBe(403);
  });

  it('يمنع الوصول بدون مصادقة', async () => {
    expect((await request(app).get('/api/shops/me')).status).toBe(401);
    expect((await request(app).post('/api/products').send({})).status).toBe(401);
  });

  it('يعيد محل صاحب الحساب فقط', async () => {
    const res = await request(app).get('/api/shops/me').set(bearer(nearShop.token));
    expect(res.status).toBe(200);
    expect(res.body.shop.id).toBe(nearShop.shop.id);
  });

  it('يسمح لصاحب المحل بتعديل محله وتبديل حالة الفتح', async () => {
    const update = await request(app)
      .patch('/api/shops/me')
      .set(bearer(nearShop.token))
      .send({ name: 'محل محدَّث', deliveryFee: 180, openingTime: '09:00' });
    expect(update.status).toBe(200);
    expect(update.body.shop.name).toBe('محل محدَّث');
    expect(update.body.shop.deliveryFee).toBe(180);

    const toggle = await request(app)
      .patch('/api/shops/me/open')
      .set(bearer(nearShop.token))
      .send({ isOpen: false });
    expect(toggle.status).toBe(200);
    expect(toggle.body.isOpen).toBe(false);

    await request(app)
      .patch('/api/shops/me/open')
      .set(bearer(nearShop.token))
      .send({ isOpen: true });
  });

  it('يرفض وقت عمل بصيغة خاطئة', async () => {
    const res = await request(app)
      .patch('/api/shops/me')
      .set(bearer(nearShop.token))
      .send({ openingTime: '9 صباحا' });
    expect(res.status).toBe(400);
  });

  it('يمنع المحل قيد المراجعة من فتح المحل أو إضافة منتجات', async () => {
    const open = await request(app)
      .patch('/api/shops/me/open')
      .set(bearer(pendingShop.token))
      .send({ isOpen: true });
    expect(open.status).toBe(403);

    const product = await request(app)
      .post('/api/products')
      .set(bearer(pendingShop.token))
      .send({ name: 'منتج', price: 100 });
    expect(product.status).toBe(403);
  });
});

describe('ملكية المنتجات', () => {
  it('ينشئ منتجًا وينسبه لمحل صاحب الحساب', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(bearer(nearShop.token))
      .send({ name: 'زيت 5 لتر', price: 1050, unit: 'بيدون' });
    expect(res.status).toBe(201);

    const created = await prisma.shopProduct.findUniqueOrThrow({
      where: { id: res.body.product.id },
    });
    expect(created.shopId).toBe(nearShop.shop.id);
  });

  it('يرفض سعرًا غير صحيح أو عشريًا', async () => {
    for (const price of [0, -5, 12.5]) {
      const res = await request(app)
        .post('/api/products')
        .set(bearer(nearShop.token))
        .send({ name: 'منتج خاطئ', price });
      expect(res.status).toBe(400);
    }
  });

  it('لا يستطيع محل تعديل منتج محل آخر', async () => {
    const foreign = await createProduct(farShop.shop.id, { name: 'منتج الجار' });

    const patch = await request(app)
      .patch(`/api/products/${foreign.id}`)
      .set(bearer(nearShop.token))
      .send({ price: 1 });
    expect(patch.status).toBe(404);

    const unchanged = await prisma.shopProduct.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(unchanged.price).toBe(100);
  });

  it('لا يستطيع محل حذف منتج محل آخر', async () => {
    const foreign = await createProduct(farShop.shop.id, { name: 'منتج للحذف' });

    const res = await request(app)
      .delete(`/api/products/${foreign.id}`)
      .set(bearer(nearShop.token));
    expect(res.status).toBe(404);
    expect(await prisma.shopProduct.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });

  it('يعرض منتجات محله فقط في القائمة', async () => {
    const res = await request(app).get('/api/products?limit=50').set(bearer(nearShop.token));
    expect(res.status).toBe(200);
    const shopIds = await prisma.shopProduct.findMany({
      where: { id: { in: res.body.items.map((p: { id: string }) => p.id) } },
      select: { shopId: true },
    });
    expect(new Set(shopIds.map((s) => s.shopId))).toEqual(new Set([nearShop.shop.id]));
  });

  it('يصفّي حسب حالة التوفر ويكشف المخفي لصاحب المحل فقط', async () => {
    const hidden = await request(app)
      .get('/api/products?availability=hidden&limit=50')
      .set(bearer(nearShop.token));
    expect(hidden.body.items.map((p: { name: string }) => p.name)).toContain('منتج مخفي');

    const unavailable = await request(app)
      .get('/api/products?availability=unavailable&limit=50')
      .set(bearer(nearShop.token));
    expect(unavailable.body.items.every((p: { isAvailable: boolean }) => !p.isAvailable)).toBe(true);
  });

  it('يحذف منتج محله بنجاح', async () => {
    const own = await createProduct(nearShop.shop.id, { name: 'منتج مؤقت' });
    const res = await request(app)
      .delete(`/api/products/${own.id}`)
      .set(bearer(nearShop.token));
    expect(res.status).toBe(200);
    expect(await prisma.shopProduct.findUnique({ where: { id: own.id } })).toBeNull();
  });
});
