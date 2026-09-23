import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { MemoryStorage, setImageStorage } from '../src/lib/storage.js';
import { MAX_IMAGE_BYTES, readImageSize, sniffImageType, validateImage } from '../src/lib/image.js';
import {
  bearer,
  createAdmin,
  createCustomer,
  createProduct,
  createShop,
  resetDb,
} from './helpers/factories.js';
import { makeJpegHeader, makePng, makeWebpHeader } from './helpers/images.js';

const app = createApp();
const BARCODE = '6131234567890';
const storage = new MemoryStorage();

type ShopCtx = Awaited<ReturnType<typeof createShop>>;

const addCoke = (shop: ShopCtx, price: number, extra: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/products')
    .set(bearer(shop.token))
    .send({ barcode: BARCODE, name: 'Coca-Cola 1L', brand: 'Coca-Cola', unit: '1L', price, ...extra });

const uploadAsShop = (shop: ShopCtx, listingId: string, bytes: Buffer, type = 'image/png') =>
  request(app)
    .put(`/api/products/${listingId}/image`)
    .set(bearer(shop.token))
    .set('Content-Type', type)
    .send(bytes);

const uploadAsAdmin = (token: string, productId: string, bytes: Buffer, type = 'image/png') =>
  request(app)
    .put(`/api/admin/products/${productId}/image`)
    .set(bearer(token))
    .set('Content-Type', type)
    .send(bytes);

const productOf = (productId: string) => prisma.product.findUniqueOrThrow({ where: { id: productId } });

beforeAll(() => setImageStorage(storage));
afterAll(async () => {
  setImageStorage(null);
  await prisma.$disconnect();
});

describe('صور المنتجات: صورة واحدة للمنتج العالمي لكل المحلات', () => {
  let a: ShopCtx;
  let b: ShopCtx;
  let c: ShopCtx;

  beforeEach(async () => {
    await resetDb();
    storage.files.clear();
    storage.failNextPut = false;
    storage.putDelayMs = 0;
    a = await createShop();
    b = await createShop();
    c = await createShop();
  });

  /** Shop A يضيف Coca-Cola ثم يرفع صورتها */
  async function cokeWithImage() {
    const added = await addCoke(a, 120, { stock: 20 });
    expect(added.status).toBe(201);
    const up = await uploadAsShop(a, added.body.product.id, makePng());
    expect(up.status).toBe(200);
    return { listingA: added.body.product.id as string, productId: added.body.product.productId as string, url: up.body.product.imageUrl as string };
  }

  it('TEST 1: منتج جديد + صورة → Product واحد مع imageUrl والملف في التخزين', async () => {
    const { productId, url } = await cokeWithImage();
    expect(await prisma.product.count()).toBe(1);
    expect((await productOf(productId)).imageUrl).toBe(url);
    expect(url.startsWith(MemoryStorage.PREFIX)).toBe(true);
    expect(storage.files.size).toBe(1);
    const stored = storage.files.get(storage.pathFromUrl(url)!)!;
    expect(stored.contentType).toBe('image/png');
    // الصورة في Product وليست في ShopProduct
    const listing = await prisma.shopProduct.findFirstOrThrow();
    expect('imageUrl' in listing).toBe(false);
  });

  it('TEST 2 + 3 + 17: محل B يدخل نفس الباركود → نفس Product ونفس الصورة دون رفع ثانٍ', async () => {
    const { productId, url } = await cokeWithImage();

    const lookup = await request(app).get(`/api/products/barcode/${BARCODE}`).set(bearer(b.token));
    expect(lookup.body.status).toBe('AVAILABLE_TO_ADD');
    expect(lookup.body.product.imageUrl).toBe(url);
    expect(lookup.body.product.name).toBe('Coca-Cola 1L');

    const rb = await request(app).post('/api/products').set(bearer(b.token)).send({ barcode: BARCODE, price: 135, stock: 10 });
    expect(rb.status).toBe(201);
    expect(rb.body.product.productId).toBe(productId);
    expect(rb.body.product.imageUrl).toBe(url);
    expect(rb.body.createdGlobalProduct).toBe(false);
    expect(await prisma.product.count()).toBe(1);
    expect(storage.files.size).toBe(1);
  });

  it('TEST 4: منتج موجود بلا صورة → المحل يضيف أول صورة وتُربط بالمنتج العالمي', async () => {
    const ra = await addCoke(a, 120);
    const rb = await addCoke(b, 135);
    expect((await productOf(ra.body.product.productId)).imageUrl).toBeNull();

    const up = await uploadAsShop(b, rb.body.product.id, makeJpegHeader(), 'image/jpeg');
    expect(up.status).toBe(200);
    const p = await productOf(ra.body.product.productId);
    expect(p.imageUrl).toBe(up.body.product.imageUrl);
    expect(p.imageUrl!.endsWith('.jpg')).toBe(true);
    // A يرى نفس الصورة في لوحته
    const mine = await request(app).get('/api/products').set(bearer(a.token));
    expect(mine.body.items[0].imageUrl).toBe(p.imageUrl);
  });

  it('TEST 5 + 8(أمني): صورة موجودة → محل عادي لا يستبدلها ولا يحذفها (Coca-Cola لا تصبح Pepsi)', async () => {
    const { productId, url } = await cokeWithImage();
    const rb = await addCoke(b, 135);

    const replace = await uploadAsShop(b, rb.body.product.id, makePng(100, 100, [0, 0, 200]));
    expect(replace.status).toBe(403);
    // حتى المحل الذي رفعها أولًا لا يستبدلها بعد أن صارت عالمية
    const replaceByA = await uploadAsShop(a, rb.body.product.id, makePng());
    expect(replaceByA.status).toBe(404); // عرض محل آخر
    const del = await request(app).delete(`/api/products/${rb.body.product.id}/image`).set(bearer(b.token));
    expect(del.status).toBe(403);

    expect((await productOf(productId)).imageUrl).toBe(url);
    expect(storage.files.size).toBe(1);
  });

  it('المحل لا يمرّر رابط صورة عبر JSON (لا روابط خارجية على منتج عالمي)', async () => {
    const created = await addCoke(a, 120, { imageUrl: 'https://evil.example/pepsi.png' });
    expect(created.status).toBe(201);
    expect(created.body.product.imageUrl).toBeNull();
    const { url } = { url: (await uploadAsShop(a, created.body.product.id, makePng())).body.product.imageUrl };
    const patch = await request(app)
      .patch(`/api/products/${created.body.product.id}`)
      .set(bearer(a.token))
      .send({ imageUrl: 'https://evil.example/pepsi.png', price: 125 });
    expect(patch.status).toBe(200);
    const p = await productOf(created.body.product.productId);
    expect(p.imageUrl).toBe(url);
  });

  it('المحل يستبدل/يحذف صورة منتج خاص به فقط (بلا باركود ولا يعرضه غيره)', async () => {
    const own = await request(app).post('/api/products').set(bearer(a.token)).send({ name: 'خبز الدار', price: 30 });
    expect(own.status).toBe(201);
    const first = await uploadAsShop(a, own.body.product.id, makePng());
    const second = await uploadAsShop(a, own.body.product.id, makeWebpHeader(), 'image/webp');
    expect(second.status).toBe(200);
    expect(second.body.product.imageUrl).not.toBe(first.body.product.imageUrl);
    // القديمة حُذفت بعد نجاح الاستبدال
    expect(storage.files.size).toBe(1);
    const del = await request(app).delete(`/api/products/${own.body.product.id}/image`).set(bearer(a.token));
    expect(del.status).toBe(200);
    expect(del.body.product.imageUrl).toBeNull();
    expect(storage.files.size).toBe(0);
  });

  it('TEST 6 + 11: الإدارة تغيّر الصورة → تظهر للمحلات والزبائن، والأسعار لا تتغير', async () => {
    const { productId, url: oldUrl, listingA } = await cokeWithImage();
    const rb = await addCoke(b, 135);
    const admin = await createAdmin('ADMIN');

    const res = await uploadAsAdmin(admin.token, productId, makeWebpHeader(), 'image/webp');
    expect(res.status).toBe(200);
    const newUrl = res.body.product.imageUrl as string;
    expect(newUrl).not.toBe(oldUrl);
    expect(newUrl.endsWith('.webp')).toBe(true);

    // القديمة حُذفت من التخزين بعد نجاح التحديث فقط
    expect(storage.files.has(storage.pathFromUrl(oldUrl)!)).toBe(false);
    expect(storage.files.has(storage.pathFromUrl(newUrl)!)).toBe(true);

    const pubA = await request(app).get(`/api/shops/${a.shop.id}/products`);
    const pubB = await request(app).get(`/api/shops/${b.shop.id}/products`);
    expect(pubA.body.items[0].imageUrl).toBe(newUrl);
    expect(pubB.body.items[0].imageUrl).toBe(newUrl);
    expect(pubA.body.items[0].price).toBe(120);
    expect(pubB.body.items[0].price).toBe(135);
    const mineB = await request(app).get('/api/products').set(bearer(b.token));
    expect(mineB.body.items[0].imageUrl).toBe(newUrl);

    const la = await prisma.shopProduct.findUniqueOrThrow({ where: { id: listingA } });
    const lb = await prisma.shopProduct.findUniqueOrThrow({ where: { id: rb.body.product.id } });
    expect([la.price, la.stock, lb.price]).toEqual([120, 20, 135]);

    const log = await prisma.adminAuditLog.findFirstOrThrow({ where: { targetId: productId } });
    expect(log.action).toBe('PRODUCT_UPDATED');
    expect((log.metadata as { image: string }).image).toBe('replaced');
  });

  it('TEST 7: حذف الصورة → imageUrl=null، والمنتج والعروض تبقى', async () => {
    const { productId, url } = await cokeWithImage();
    await addCoke(b, 135);
    const admin = await createAdmin('ADMIN');
    const del = await request(app).delete(`/api/admin/products/${productId}/image`).set(bearer(admin.token));
    expect(del.status).toBe(200);
    expect(del.body.product.imageUrl).toBeNull();
    expect((await productOf(productId)).imageUrl).toBeNull();
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.shopProduct.count()).toBe(2);
    expect(storage.files.has(storage.pathFromUrl(url)!)).toBe(false);
  });

  it('لا يُحذف ملف ما زال رابطه مستعملًا في مكان آخر', async () => {
    const { productId, url } = await cokeWithImage();
    // منتج آخر يشير لنفس الرابط (حالة بيانات قديمة/يدوية)
    await prisma.product.create({ data: { name: 'نسخة', unit: 'x', imageUrl: url } });
    const admin = await createAdmin('ADMIN');
    await request(app).delete(`/api/admin/products/${productId}/image`).set(bearer(admin.token));
    expect(storage.files.has(storage.pathFromUrl(url)!)).toBe(true);
  });

  it('TEST 8: ملف ليس صورة (نص/HTML/SVG/تنفيذي أو نوع مزوّر) → رفض بلا أي تغيير', async () => {
    const added = await addCoke(a, 120);
    const id = added.body.product.id as string;
    const cases: [Buffer, string][] = [
      [Buffer.from('hello world, not an image'), 'image/png'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml'],
      [Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg'],
      [Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), 'application/octet-stream'],
      [makePng(), 'image/jpeg'], // النوع المعلن لا يطابق المحتوى
      [Buffer.from(makePng().subarray(0, 12)), 'image/png'], // ملف مبتور
      [makePng(10, 10), 'image/png'], // صغيرة جدًا
      [makeJpegHeader(9000, 9000), 'image/jpeg'], // أبعاد ضخمة
    ];
    for (const [bytes, type] of cases) {
      const res = await uploadAsShop(a, id, bytes, type);
      expect(res.status, type).toBe(400);
    }
    const json = await request(app).put(`/api/products/${id}/image`).set(bearer(a.token)).send({ imageUrl: 'https://x.y/z.png' });
    expect(json.status).toBe(400);
    expect((await productOf(added.body.product.productId)).imageUrl).toBeNull();
    expect(storage.files.size).toBe(0);
  });

  it('TEST 9: صورة أكبر من الحد → رفض (413) قبل أي رفع', async () => {
    const added = await addCoke(a, 120);
    const big = Buffer.concat([makePng(), Buffer.alloc(MAX_IMAGE_BYTES)]);
    const res = await uploadAsShop(a, added.body.product.id, big);
    expect(res.status).toBe(413);
    expect(storage.files.size).toBe(0);
    expect((await productOf(added.body.product.productId)).imageUrl).toBeNull();
  });

  it('TEST 10: تغيير سعر محل A لا يغيّر الصورة', async () => {
    const { listingA, productId, url } = await cokeWithImage();
    const upd = await request(app).patch(`/api/products/${listingA}`).set(bearer(a.token)).send({ price: 150, stock: 5 });
    expect(upd.status).toBe(200);
    expect(upd.body.product.imageUrl).toBe(url);
    expect((await productOf(productId)).imageUrl).toBe(url);
  });

  it('TEST 12: المنتج في طلبات قديمة → تغيير/حذف الصورة لا يمس الطلب ولقطته', async () => {
    const { listingA, productId } = await cokeWithImage();
    const customer = await createCustomer();
    const order = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({ shopId: a.shop.id, addressId: customer.address.id, items: [{ productId: listingA, quantity: 2 }] });
    expect(order.status).toBe(201);
    const orderId = order.body.order.id as string;
    const before = await prisma.orderItem.findMany({ where: { orderId } });

    const admin = await createAdmin('ADMIN');
    expect((await uploadAsAdmin(admin.token, productId, makeWebpHeader(), 'image/webp')).status).toBe(200);
    expect((await request(app).delete(`/api/admin/products/${productId}/image`).set(bearer(admin.token))).status).toBe(200);

    const after = await prisma.orderItem.findMany({ where: { orderId } });
    expect(after).toEqual(before);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(o.total).toBe(order.body.order.total);
    const view = await request(app).get(`/api/orders/${orderId}`).set(bearer(customer.token));
    expect(view.status).toBe(200);
    expect(view.body.order.items[0].nameSnapshot).toBe('Coca-Cola 1L');
    expect(view.body.order.items[0].product.product.imageUrl).toBeNull();
  });

  it('TEST 13: ثلاثة محلات تعرض نفس المنتج → صورة واحدة', async () => {
    const { url } = await cokeWithImage();
    await addCoke(b, 135);
    await addCoke(c, 125);
    const cat = await request(app).get(`/api/catalog/barcode/${BARCODE}`);
    expect(cat.body.product.imageUrl).toBe(url);
    expect(cat.body.shops.map((s: { price: number }) => s.price)).toEqual([120, 125, 135]);
    const urls = await prisma.product.findMany({ select: { imageUrl: true } });
    expect(urls).toEqual([{ imageUrl: url }]);
    expect(storage.files.size).toBe(1);
  });

  it('TEST 14 + 19: نفس الباركود بصورة مختلفة → لا Product ثانٍ', async () => {
    await cokeWithImage();
    const rb = await addCoke(b, 135, { name: 'Pepsi 1L' });
    expect(rb.status).toBe(201);
    const try2 = await uploadAsShop(b, rb.body.product.id, makePng(100, 100, [0, 0, 255]));
    expect(try2.status).toBe(403);
    expect(await prisma.product.count({ where: { barcode: BARCODE } })).toBe(1);
    const again = await addCoke(a, 999);
    expect(again.status).toBe(409);
    expect(await prisma.product.count()).toBe(1);
  });

  it('سباق: محلان يرفعان أول صورة لنفس المنتج معًا → صورة واحدة تفوز ولا ملفات يتيمة', async () => {
    const ra = await addCoke(a, 120);
    const rb = await addCoke(b, 135);
    const [r1, r2] = await Promise.all([
      uploadAsShop(a, ra.body.product.id, makePng()),
      uploadAsShop(b, rb.body.product.id, makeJpegHeader(), 'image/jpeg'),
    ]);
    // واحد فقط ينجح؛ الآخر يُرفض (409 إن تسابقا على التحديث الذري، أو 403 إن قرأ الصورة بعد حفظها)
    const statuses = [r1.status, r2.status];
    expect(statuses.filter((x) => x === 200)).toHaveLength(1);
    expect(statuses.filter((x) => x === 409 || x === 403)).toHaveLength(1);
    const p = await productOf(ra.body.product.productId);
    expect(storage.files.size).toBe(1);
    expect(storage.files.has(storage.pathFromUrl(p.imageUrl!)!)).toBe(true);
  });

  it('سباق حقيقي على التحديث الذري: الخاسر يُرفض 409 ويُحذف ملفه المرفوع', async () => {
    const ra = await addCoke(a, 120);
    const rb = await addCoke(b, 135);
    storage.putDelayMs = 300; // كلاهما يقرأ «بلا صورة» ثم يرفع، ثم يتسابقان على التحديث المشروط
    const [r1, r2] = await Promise.all([
      uploadAsShop(a, ra.body.product.id, makePng()),
      uploadAsShop(b, rb.body.product.id, makeJpegHeader(), 'image/jpeg'),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.details.reason).toBe('IMAGE_ALREADY_SET');
    const p = await productOf(ra.body.product.productId);
    expect(storage.files.size).toBe(1);
    expect(storage.files.has(storage.pathFromUrl(p.imageUrl!)!)).toBe(true);
  });

  it('فشل رفع الصورة الجديدة لا يمس الصورة القديمة', async () => {
    const { productId, url } = await cokeWithImage();
    const admin = await createAdmin('ADMIN');
    storage.failNextPut = true;
    const res = await uploadAsAdmin(admin.token, productId, makeWebpHeader(), 'image/webp');
    expect(res.status).toBe(502);
    expect((await productOf(productId)).imageUrl).toBe(url);
    expect(storage.files.has(storage.pathFromUrl(url)!)).toBe(true);
  });

  it('المصادقة والصلاحيات: بلا دخول 401، زبون/محل على مسار الإدارة 403، عرض محل آخر 404', async () => {
    const { productId, listingA } = await cokeWithImage();
    const customer = await createCustomer();
    expect((await request(app).put(`/api/products/${listingA}/image`).set('Content-Type', 'image/png').send(makePng())).status).toBe(401);
    expect((await request(app).put(`/api/admin/products/${productId}/image`).set('Content-Type', 'image/png').send(makePng())).status).toBe(401);
    expect((await uploadAsShop({ ...a, token: customer.token }, listingA, makePng())).status).toBe(403);
    expect((await uploadAsAdmin(a.token, productId, makePng())).status).toBe(403);
    expect((await request(app).delete(`/api/admin/products/${productId}/image`).set(bearer(a.token))).status).toBe(403);
    expect((await uploadAsShop(b, listingA, makePng())).status).toBe(404);
  });

  it('محل غير معتمد لا يرفع صورًا', async () => {
    const pending = await createShop({ status: 'PENDING' });
    const listing = await createProduct(pending.shop.id, { name: 'x' });
    const res = await uploadAsShop(pending, listing.id, makePng());
    expect(res.status).toBe(403);
  });

  it('الإدارة: قائمة المنتجات العالمية مع فلتر الصورة وعدد المحلات', async () => {
    await cokeWithImage();
    await addCoke(b, 130);
    await request(app).post('/api/products').set(bearer(c.token)).send({ barcode: '6130000000001', name: 'Hamoud 1L', price: 90 });
    const admin = await createAdmin('ADMIN');
    const all = await request(app).get('/api/admin/products').set(bearer(admin.token));
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBe(2);
    const without = await request(app).get('/api/admin/products?image=without').set(bearer(admin.token));
    expect(without.body.items.map((p: { name: string }) => p.name)).toEqual(['Hamoud 1L']);
    const withImg = await request(app).get('/api/admin/products?image=with&q=coca').set(bearer(admin.token));
    expect(withImg.body.items[0].shopsCount).toBe(2);
    expect((await request(app).get('/api/admin/products').set(bearer(a.token))).status).toBe(403);
  });

  it('تخزين غير مهيأ → 503 واضح دون تعديل المنتج', async () => {
    const added = await addCoke(a, 120);
    setImageStorage(null);
    try {
      const res = await uploadAsShop(a, added.body.product.id, makePng());
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
    } finally {
      setImageStorage(storage);
    }
    expect((await productOf(added.body.product.productId)).imageUrl).toBeNull();
  });
});

describe('التحقق من ملف الصورة (وحدة)', () => {
  it('يتعرّف على JPEG/PNG/WebP من المحتوى ويقرأ الأبعاد', () => {
    expect(sniffImageType(makePng())).toBe('image/png');
    expect(sniffImageType(makeJpegHeader())).toBe('image/jpeg');
    expect(sniffImageType(makeWebpHeader())).toBe('image/webp');
    expect(sniffImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(readImageSize(makePng(321, 123), 'image/png')).toEqual({ width: 321, height: 123 });
    expect(readImageSize(makeJpegHeader(640, 480), 'image/jpeg')).toEqual({ width: 640, height: 480 });
    expect(readImageSize(makeWebpHeader(800, 600), 'image/webp')).toEqual({ width: 800, height: 600 });
    expect(validateImage(makePng(), 'image/png; charset=binary').ext).toBe('png');
    expect(validateImage(makeJpegHeader(), 'image/jpg').mime).toBe('image/jpeg');
  });
});
