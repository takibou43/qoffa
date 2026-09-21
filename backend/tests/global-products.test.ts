import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  bearer,
  createAdmin,
  createCustomer,
  createProduct,
  createShop,
  resetDb,
} from './helpers/factories.js';

const app = createApp();
const BARCODE = '6131234567890';

afterAll(async () => {
  await prisma.$disconnect();
});

type ShopCtx = Awaited<ReturnType<typeof createShop>>;

const add = (shop: ShopCtx, body: Record<string, unknown>) =>
  request(app).post('/api/products').set(bearer(shop.token)).send(body);

const addCoke = (shop: ShopCtx, price: number, extra: Record<string, unknown> = {}) =>
  add(shop, { barcode: BARCODE, name: 'Coca-Cola 1L', unit: 'قارورة', price, ...extra });

const counts = async () => ({
  products: await prisma.product.count(),
  listings: await prisma.shopProduct.count(),
});

describe('المنتج العالمي بالباركود + عرض المحل', () => {
  let a: ShopCtx;
  let b: ShopCtx;
  let c: ShopCtx;

  beforeEach(async () => {
    await resetDb();
    a = await createShop();
    b = await createShop();
    c = await createShop();
  });

  it('TEST 1: محل A يضيف باركودًا جديدًا → Product=1, ShopProduct=1', async () => {
    const res = await addCoke(a, 120, { stock: 20 });
    expect(res.status).toBe(201);
    expect(await counts()).toEqual({ products: 1, listings: 1 });
  });

  it('TEST 2 + 5 + 12: محل B يضيف نفس الباركود → نفس المنتج العالمي و ShopProduct ثانٍ', async () => {
    const r1 = await addCoke(a, 120);
    // B لا يرسل اسمًا: المنتج موجود عالميًا
    const r2 = await add(b, { barcode: BARCODE, price: 135 });
    expect(r2.status).toBe(201);
    expect(await counts()).toEqual({ products: 1, listings: 2 });
    expect(r1.body.product.productId).toBe(r2.body.product.productId);
    expect(r2.body.product.name).toBe('Coca-Cola 1L');
    expect(r2.body.createdGlobalProduct).toBe(false);
  });

  it('TEST 3: A يعيد إضافة نفس الباركود → 409 بلا تكرار', async () => {
    await addCoke(a, 120);
    const again = await addCoke(a, 999);
    expect(again.status).toBe(409);
    expect(await counts()).toEqual({ products: 1, listings: 1 });
    const l = await prisma.shopProduct.findFirstOrThrow({ where: { shopId: a.shop.id } });
    expect(l.price).toBe(120); // لم يُستبدل السعر
  });

  it('TEST 4: B يعيد الإضافة → لا تكرار', async () => {
    await addCoke(a, 120);
    await addCoke(b, 135);
    const again = await addCoke(b, 140);
    expect(again.status).toBe(409);
    expect(await counts()).toEqual({ products: 1, listings: 2 });
  });

  it('TEST 6 + قاعدة السعر: A من 120 إلى 130 لا يمس B ولا C ولا المنتج العالمي', async () => {
    const ra = await addCoke(a, 120);
    const rb = await addCoke(b, 135);
    const rc = await addCoke(c, 125);
    const productId = ra.body.product.productId as string;
    const before = await prisma.product.findUniqueOrThrow({ where: { id: productId } });

    const upd = await request(app)
      .patch(`/api/products/${ra.body.product.id}`)
      .set(bearer(a.token))
      .send({ price: 130 });
    expect(upd.status).toBe(200);

    const price = async (listingId: string) =>
      (await prisma.shopProduct.findUniqueOrThrow({ where: { id: listingId } })).price;
    expect(await price(ra.body.product.id)).toBe(130);
    expect(await price(rb.body.product.id)).toBe(135);
    expect(await price(rc.body.product.id)).toBe(125);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(after).toEqual(before);
    expect('price' in after).toBe(false);
  });

  it('واجهة الزبون تعرض سعر المحل المحدد لا سعرًا عالميًا', async () => {
    await addCoke(a, 130);
    await addCoke(b, 135);
    const ra = await request(app).get(`/api/shops/${a.shop.id}/products`);
    const rb = await request(app).get(`/api/shops/${b.shop.id}/products`);
    expect(ra.status).toBe(200);
    expect(ra.body.items[0].price).toBe(130);
    expect(rb.body.items[0].price).toBe(135);

    const cat = await request(app).get(`/api/catalog/barcode/${BARCODE}`);
    expect(cat.status).toBe(200);
    expect(cat.body.shops.map((s: { price: number }) => s.price)).toEqual([130, 135]);
  });

  it('TEST 7: إنشاء منتج مكرر مباشرة عبر الـAPI يعيد استعمال المنتج ولا ينشئ ثانيًا', async () => {
    await addCoke(a, 120);
    const res = await add(b, { barcode: BARCODE, name: 'Pepsi 1L', price: 100 });
    expect(res.status).toBe(201);
    expect(await prisma.product.count()).toBe(1);
    // اسم المحل الثاني مُتجاهل: لا يغيّر المنتج العالمي
    const p = await prisma.product.findFirstOrThrow();
    expect(p.name).toBe('Coca-Cola 1L');
  });

  it('TEST 8: طلبات متزامنة لنفس الباركود من محلات مختلفة → Product واحد', async () => {
    const shops = await Promise.all(Array.from({ length: 6 }, () => createShop()));
    const results = await Promise.all(shops.map((s, i) => addCoke(s, 100 + i)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await prisma.product.count({ where: { barcode: BARCODE } })).toBe(1);
    expect(await prisma.shopProduct.count()).toBe(6);
  });

  it('TEST 8b: طلبات متزامنة من نفس المحل → عرض واحد فقط', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => addCoke(a, 120)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await counts()).toEqual({ products: 1, listings: 1 });
  });

  it('قاعدة البيانات نفسها ترفض Product مكررًا و ShopProduct مكررًا', async () => {
    const r = await addCoke(a, 120);
    await expect(
      prisma.product.create({ data: { barcode: BARCODE, name: 'dup', unit: 'x' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.shopProduct.create({
        data: { shopId: a.shop.id, productId: r.body.product.productId, price: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('TEST 9: باركود غير صالح → خطأ تحقق واضح', async () => {
    for (const bad of ['12', 'abc def!', '<script>', 'x'.repeat(60)]) {
      const res = await add(a, { barcode: bad, name: 'س', price: 10 });
      expect(res.status).toBe(400);
    }
    const lookup = await request(app).get('/api/products/barcode/%20%20').set(bearer(a.token));
    expect([400, 404]).toContain(lookup.status);
    expect(await counts()).toEqual({ products: 0, listings: 0 });
  });

  it('تطبيع الباركود: المسافات لا تنشئ منتجًا ثانيًا', async () => {
    await addCoke(a, 120);
    const res = await add(b, { barcode: `  ${BARCODE} `, price: 135 });
    expect(res.status).toBe(201);
    expect(await prisma.product.count()).toBe(1);
  });

  it('TEST 10: حذف عرض محل يُبقي المنتج العالمي إن استعملته محلات أخرى', async () => {
    const ra = await addCoke(a, 120);
    await addCoke(b, 135);
    const del = await request(app)
      .delete(`/api/products/${ra.body.product.id}`)
      .set(bearer(a.token));
    expect([200, 204]).toContain(del.status);
    expect(await counts()).toEqual({ products: 1, listings: 1 });
  });

  it('لا يعدّل المحل بيانات المنتج العالمي (403) ولا عرض محل آخر (404)', async () => {
    const ra = await addCoke(a, 120);
    await addCoke(b, 135);
    const rename = await request(app)
      .patch(`/api/products/${ra.body.product.id}`)
      .set(bearer(a.token))
      .send({ name: 'Pepsi 1L' });
    expect(rename.status).toBe(403);

    const foreign = await request(app)
      .patch(`/api/products/${ra.body.product.id}`)
      .set(bearer(b.token))
      .send({ price: 1 });
    expect(foreign.status).toBe(404);
    const foreignDel = await request(app)
      .delete(`/api/products/${ra.body.product.id}`)
      .set(bearer(b.token));
    expect(foreignDel.status).toBe(404);
    expect((await prisma.product.findFirstOrThrow()).name).toBe('Coca-Cola 1L');
  });

  it('الإدارة وحدها تعدّل البيانات العالمية', async () => {
    const ra = await addCoke(a, 120);
    const admin = await createAdmin('ADMIN');
    const res = await request(app)
      .patch(`/api/admin/products/${ra.body.product.productId}`)
      .set(bearer(admin.token))
      .send({ name: 'Coca-Cola Zero 1L' });
    expect(res.status).toBe(200);
    expect((await prisma.product.findFirstOrThrow()).name).toBe('Coca-Cola Zero 1L');
  });

  it('مسح الباركود: NEW / AVAILABLE_TO_ADD / ALREADY_LISTED', async () => {
    const st = async (s: ShopCtx) =>
      (await request(app).get(`/api/products/barcode/${BARCODE}`).set(bearer(s.token))).body.status;
    expect(await st(a)).toBe('NEW');
    await addCoke(a, 120);
    expect(await st(a)).toBe('ALREADY_LISTED');
    expect(await st(b)).toBe('AVAILABLE_TO_ADD');
  });

  it('TEST 11 + دورة كاملة: لقطة الطلب تحتفظ بسعرها ولا يتأثر بتغيير الأسعار', async () => {
    const customer = await createCustomer();
    const ra = await addCoke(a, 100);
    const rb = await addCoke(b, 120);

    const order = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: a.shop.id,
        addressId: customer.address.id,
        items: [{ productId: ra.body.product.id, quantity: 2 }],
      });
    expect(order.status).toBe(201);
    const orderId = order.body.order.id as string;

    await request(app)
      .patch(`/api/products/${ra.body.product.id}`)
      .set(bearer(a.token))
      .send({ price: 110 });
    await request(app)
      .patch(`/api/products/${rb.body.product.id}`)
      .set(bearer(b.token))
      .send({ price: 150 });

    const items = await prisma.orderItem.findMany({ where: { orderId } });
    expect(items).toHaveLength(1);
    expect(items[0]!.unitPrice).toBe(100);
    expect(items[0]!.nameSnapshot).toBe('Coca-Cola 1L');

    // حذف عرض المحل لا يمسح الطلب ولا لقطته
    await request(app).delete(`/api/products/${ra.body.product.id}`).set(bearer(a.token));
    const still = await prisma.orderItem.findMany({ where: { orderId } });
    expect(still).toHaveLength(1);
    expect(still[0]!.unitPrice).toBe(100);
    expect(still[0]!.productId).toBeNull();
    expect(await prisma.order.count({ where: { id: orderId } })).toBe(1);
  });

  it('لا تكرار في قاعدة البيانات بعد كل ذلك', async () => {
    await addCoke(a, 120);
    await addCoke(b, 135);
    await addCoke(c, 125);
    const dupBarcodes = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM (SELECT barcode FROM "Product" WHERE barcode IS NOT NULL GROUP BY barcode HAVING COUNT(*) > 1) t`,
    );
    const dupListings = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM (SELECT "shopId","productId" FROM "ShopProduct" GROUP BY 1,2 HAVING COUNT(*) > 1) t`,
    );
    expect(Number(dupBarcodes[0]!.n)).toBe(0);
    expect(Number(dupListings[0]!.n)).toBe(0);
    expect(await counts()).toEqual({ products: 1, listings: 3 });
  });

  it('المصنع createProduct يعيد استعمال المنتج العالمي بالباركود', async () => {
    const x = await createProduct(a.shop.id, { barcode: 'ABC-1234', price: 5 });
    const y = await createProduct(b.shop.id, { barcode: 'ABC-1234', price: 6 });
    expect(x.productId).toBe(y.productId);
  });
});
