import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { MemoryStorage, setImageStorage } from '../src/lib/storage.js';
import { ExternalHttpError } from '../src/lib/safeFetch.js';
import { lookupTesting } from '../src/modules/products/products.service.js';
import {
  externalCatalogTesting,
  type SourceResult,
} from '../src/services/externalCatalog.js';
import { bearer, createCustomer, createShop, resetDb } from './helpers/factories.js';
import { makePng } from './helpers/images.js';

/**
 * البحث بالباركود: قُفّة أولًا ← Open Food Facts ← UPCitemdb ← يدوي.
 * المصادر الخارجية وتنزيل الصور مُحاكاة (لا إنترنت في الاختبارات)، وقاعدة PostgreSQL حقيقية.
 */
const app = createApp();
const storage = new MemoryStorage();
const BARCODE = '6131234567890';

type ShopCtx = Awaited<ReturnType<typeof createShop>>;

interface Calls {
  off: string[];
  upc: string[];
  download: string[];
}
let calls: Calls;

const OFF_IMG = 'https://images.openfoodfacts.org/images/products/613/123/456/7890/front_fr.4.400.jpg';
const UPC_IMG = 'https://cdn.example-retailer.com/coke.png';

const offFound = (overrides: Partial<{ name: string; images: string[] }> = {}): SourceResult => ({
  kind: 'FOUND',
  product: {
    source: 'OPEN_FOOD_FACTS',
    name: overrides.name ?? 'Coca-Cola Original Taste',
    brand: 'Coca-Cola',
    quantity: '1 L',
    imageCandidates: overrides.images ?? [OFF_IMG],
  },
});
const upcFound = (images = [UPC_IMG]): SourceResult => ({
  kind: 'FOUND',
  product: { source: 'UPCITEMDB', name: 'Coke 1L Bottle', brand: 'Coca-Cola', quantity: '1L', imageCandidates: images },
});
const NOT_FOUND: SourceResult = { kind: 'NOT_FOUND' };
const TIMEOUT: SourceResult = { kind: 'ERROR', reason: 'TIMEOUT' };

type Img = { bytes: Buffer; contentType: string };
function setSources(
  off: SourceResult | ((b: string) => Promise<SourceResult>),
  upc: SourceResult | ((b: string) => Promise<SourceResult>),
  download: (url: string) => Promise<Img> = async () => ({ bytes: makePng(), contentType: 'image/png' }),
) {
  externalCatalogTesting.set({
    off: async (b) => {
      calls.off.push(b);
      return typeof off === 'function' ? off(b) : off;
    },
    upc: async (b) => {
      calls.upc.push(b);
      return typeof upc === 'function' ? upc(b) : upc;
    },
    download: async (url) => {
      calls.download.push(url);
      return download(url);
    },
  });
}

const lookup = (shop: ShopCtx, code = BARCODE) =>
  request(app).get(`/api/products/barcode/${code}`).set(bearer(shop.token));
const add = (shop: ShopCtx, body: Record<string, unknown>) =>
  request(app).post('/api/products').set(bearer(shop.token)).send(body);

beforeAll(() => setImageStorage(storage));
afterAll(async () => {
  externalCatalogTesting.reset();
  setImageStorage(null);
  await prisma.$disconnect();
});

describe('البحث بالباركود مع المصادر الخارجية', () => {
  let a: ShopCtx;
  let b: ShopCtx;
  let c: ShopCtx;

  beforeEach(async () => {
    await resetDb();
    storage.files.clear();
    storage.putDelayMs = 0;
    lookupTesting.reset();
    calls = { off: [], upc: [], download: [] };
    setSources(offFound(), NOT_FOUND);
    a = await createShop();
    b = await createShop();
    c = await createShop();
  });
  afterEach(() => externalCatalogTesting.reset());

  it('TEST 1 + 15: منتج في قُفّة وله صورة → لا أي استدعاء خارجي', async () => {
    await prisma.product.create({
      data: { barcode: BARCODE, name: 'Coca-Cola 1L', unit: '1L', imageUrl: 'https://storage.test/product-images/x.png', imageSource: 'ADMIN_UPLOAD' },
    });
    const r = await lookup(a);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('AVAILABLE_TO_ADD');
    expect(r.body.lookup.source).toBe('QOFFA');
    expect(calls).toEqual({ off: [], upc: [], download: [] });
  });

  it('TEST 2 + 4(حالة موجود): منتج بلا صورة → يُبحث خارجيًا عن الصورة فقط', async () => {
    const p = await prisma.product.create({ data: { barcode: BARCODE, name: 'كوكا محلي', brand: 'X', unit: 'قارورة' } });
    await add(b, { barcode: BARCODE, price: 135, stock: 7 });
    const r = await lookup(a);
    expect(calls.off).toEqual([BARCODE]);
    expect(r.body.lookup.source).toBe('OPEN_FOOD_FACTS');
    const after = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    // الصورة فقط أُضيفت؛ الاسم والعلامة والوحدة كما هي، ولم يُنشأ منتج ثانٍ
    expect(after.imageUrl).toMatch(/^https:\/\/storage\.test\//);
    expect(after.imageSource).toBe('OPEN_FOOD_FACTS');
    expect([after.name, after.brand, after.unit]).toEqual(['كوكا محلي', 'X', 'قارورة']);
    expect(await prisma.product.count()).toBe(1);
    const lb = await prisma.shopProduct.findFirstOrThrow({ where: { shopId: b.shop.id } });
    expect([lb.price, lb.stock]).toEqual([135, 7]);

    // lookup ثانٍ: الصورة موجودة الآن → لا استدعاء خارجي
    await lookup(c);
    expect(calls.off).toHaveLength(1);
  });

  it('منتج بلا صورة ولم نجد صورة → لا نعيد السؤال الخارجي قبل 7 أيام', async () => {
    setSources(NOT_FOUND, NOT_FOUND);
    await prisma.product.create({ data: { barcode: BARCODE, name: 'منتج', unit: 'x' } });
    await lookup(a);
    await lookup(a);
    await lookup(b);
    expect(calls.off).toHaveLength(1);
    expect(calls.upc).toHaveLength(1);
  });

  it('TEST 3: Open Food Facts يجد المنتج والصورة → Product واحد والصورة في تخزين قُفّة', async () => {
    const r = await lookup(a);
    expect(r.body.status).toBe('AVAILABLE_TO_ADD');
    expect(r.body.lookup).toMatchObject({ source: 'OPEN_FOOD_FACTS', createdFromExternal: true, imageFound: true });
    expect(r.body.product).toMatchObject({ barcode: BARCODE, name: 'Coca-Cola Original Taste', brand: 'Coca-Cola', unit: '1 L', imageSource: 'OPEN_FOOD_FACTS' });
    expect(r.body.product.imageUrl.startsWith(MemoryStorage.PREFIX)).toBe(true);
    expect(r.body.product.imageUrl).not.toContain('openfoodfacts');
    expect(await prisma.product.count()).toBe(1);
    expect(storage.files.size).toBe(1);
    expect(calls.upc).toEqual([]); // وجدنا كل شيء في المصدر الأول
    // المحل يضيف سعره فقط → نفس المنتج
    const added = await add(a, { barcode: BARCODE, price: 120, stock: 20 });
    expect(added.status).toBe(201);
    expect(added.body.createdGlobalProduct).toBe(false);
    expect(added.body.product.productId).toBe(r.body.product.id);
  });

  it('TEST 4 + 5: OFF لا يجد → UPCitemdb يجد المنتج والصورة', async () => {
    setSources(NOT_FOUND, upcFound());
    const r = await lookup(a);
    expect(calls.off).toEqual([BARCODE]);
    expect(calls.upc).toEqual([BARCODE]);
    expect(r.body.lookup.source).toBe('UPCITEMDB');
    expect(r.body.product).toMatchObject({ name: 'Coke 1L Bottle', imageSource: 'UPCITEMDB' });
    expect(await prisma.product.count()).toBe(1);
    expect(storage.files.size).toBe(1);
  });

  it('OFF يجد البيانات بلا صورة صالحة → الصورة من UPCitemdb والبيانات من OFF', async () => {
    setSources(offFound({ images: [] }), upcFound());
    const r = await lookup(a);
    expect(r.body.product.name).toBe('Coca-Cola Original Taste');
    expect(r.body.product.imageSource).toBe('UPCITEMDB');
  });

  it('TEST 6 + 35: المصدران لا يجدان → NEW يدوي، ثم رفع صورة، ثم محل B يأخذها من قُفّة', async () => {
    setSources(NOT_FOUND, NOT_FOUND);
    const r = await lookup(a);
    expect(r.body.status).toBe('NEW');
    expect(r.body.lookup).toEqual({ source: 'MANUAL', externalTried: true, externalUnavailable: false });
    expect(await prisma.product.count()).toBe(0);

    const created = await add(a, { barcode: BARCODE, name: 'منتج محلي', price: 90 });
    expect(created.status).toBe(201);
    const up = await request(app)
      .put(`/api/products/${created.body.product.id}/image`)
      .set(bearer(a.token))
      .set('Content-Type', 'image/png')
      .send(makePng());
    expect(up.status).toBe(200);
    expect(up.body.product.imageSource).toBe('SHOP_UPLOAD');

    const before = { ...calls };
    const rb = await lookup(b);
    expect(rb.body.status).toBe('AVAILABLE_TO_ADD');
    expect(rb.body.lookup.source).toBe('QOFFA');
    expect(rb.body.product.imageUrl).toBe(up.body.product.imageUrl);
    expect(calls.off.length).toBe(before.off.length);
  });

  it('TEST 7: OFF timeout → ننتقل إلى UPCitemdb', async () => {
    setSources(TIMEOUT, upcFound());
    const r = await lookup(a);
    expect(r.status).toBe(200);
    expect(r.body.lookup.source).toBe('UPCITEMDB');
  });

  it('TEST 8: المصدران timeout → إدخال يدوي مع رسالة، والإضافة تعمل', async () => {
    setSources(TIMEOUT, TIMEOUT);
    const r = await lookup(a);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('NEW');
    expect(r.body.lookup.externalUnavailable).toBe(true);
    const created = await add(a, { barcode: BARCODE, name: 'يدوي', price: 50 });
    expect(created.status).toBe(201);
  });

  it('استثناء غير متوقع من مصدر خارجي لا يُسقط البحث', async () => {
    setSources(
      async () => {
        throw new ExternalHttpError('boom', 'NETWORK');
      },
      NOT_FOUND,
    );
    const r = await lookup(a);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('NEW');
  });

  it('TEST 9: الصورة الخارجية ليست صورة (HTML) → تُرفض ويُنشأ المنتج بلا صورة', async () => {
    setSources(offFound(), NOT_FOUND, async () => ({ bytes: Buffer.from('<html>x</html>'), contentType: 'image/png' }));
    const r = await lookup(a);
    expect(r.body.status).toBe('AVAILABLE_TO_ADD');
    expect(r.body.product.imageUrl).toBeNull();
    expect(r.body.lookup.imageFound).toBe(false);
    expect(storage.files.size).toBe(0);
    // المحل يستطيع رفع أول صورة يدويًا
    const added = await add(a, { barcode: BARCODE, price: 100 });
    const up = await request(app)
      .put(`/api/products/${added.body.product.id}/image`)
      .set(bearer(a.token))
      .set('Content-Type', 'image/png')
      .send(makePng());
    expect(up.status).toBe(200);
  });

  it('TEST 10: الصورة الخارجية أكبر من الحد → تُرفض', async () => {
    setSources(offFound(), NOT_FOUND, async () => {
      throw new ExternalHttpError('too large', 'TOO_LARGE');
    });
    const r = await lookup(a);
    expect(r.body.product.imageUrl).toBeNull();
    expect(storage.files.size).toBe(0);
  });

  it('تعذّر تخزين الصورة → المنتج يُنشأ بلا صورة (لا رابط خارجي)', async () => {
    storage.failNextPut = true;
    const r = await lookup(a);
    expect(r.body.status).toBe('AVAILABLE_TO_ADD');
    expect(r.body.product.imageUrl).toBeNull();
  });

  it('TEST 11: أصفار البداية محفوظة (نص لا رقم)', async () => {
    const code = '0012345678905';
    setSources(offFound(), NOT_FOUND);
    const r = await lookup(a, code);
    expect(r.body.product.barcode).toBe(code);
    expect(calls.off).toEqual([code]);
    const p = await prisma.product.findFirstOrThrow();
    expect(p.barcode).toBe('0012345678905');
  });

  it('باركود غير GTIN (داخلي/Code128) → لا بحث خارجي', async () => {
    const r = await lookup(a, 'ABC-1234');
    expect(r.body.status).toBe('NEW');
    expect(calls.off).toEqual([]);
  });

  it('TEST 12 + 13 + 14 + 19: A ثم B ثم C → نفس Product ونفس الصورة، بلا API خارجي بعد الأول، وأسعار مستقلة', async () => {
    const ra = await lookup(a);
    const la = await add(a, { barcode: BARCODE, price: 120, stock: 20 });
    const rb = await lookup(b);
    const lb = await add(b, { barcode: BARCODE, price: 135, stock: 10 });
    const rc = await lookup(c);
    const lc = await add(c, { barcode: BARCODE, price: 125 });

    expect(calls.off).toHaveLength(1);
    expect(calls.download).toHaveLength(1);
    expect(rb.body.lookup.source).toBe('QOFFA');
    expect(rc.body.lookup.source).toBe('QOFFA');
    expect(new Set([ra.body.product.id, rb.body.product.id, rc.body.product.id, la.body.product.productId, lb.body.product.productId, lc.body.product.productId]).size).toBe(1);
    expect(new Set([rb.body.product.imageUrl, rc.body.product.imageUrl, ra.body.product.imageUrl]).size).toBe(1);

    // TEST 14: A يغيّر سعره → B و C لا يتغيران
    await request(app).patch(`/api/products/${la.body.product.id}`).set(bearer(a.token)).send({ price: 130 });
    const prices = await prisma.shopProduct.findMany({ select: { shopId: true, price: true } });
    const byShop = Object.fromEntries(prices.map((x) => [x.shopId, x.price]));
    expect([byShop[a.shop.id], byShop[b.shop.id], byShop[c.shop.id]]).toEqual([130, 135, 125]);

    // الزبون: نفس الصورة وسعر كل محل
    const cat = await request(app).get(`/api/catalog/barcode/${BARCODE}`);
    expect(cat.body.product.imageUrl).toBe(ra.body.product.imageUrl);
    expect(cat.body.shops.map((s: { price: number }) => s.price)).toEqual([125, 130, 135]);
  });

  it('TEST 16: صورة SHOP_UPLOAD لا تُستبدل تلقائيًا ولا يُستدعى الخارج', async () => {
    await prisma.product.create({
      data: { barcode: BARCODE, name: 'x', unit: 'x', imageUrl: 'https://storage.test/product-images/shop.png', imageSource: 'SHOP_UPLOAD' },
    });
    const r = await lookup(a);
    expect(r.body.product.imageUrl).toBe('https://storage.test/product-images/shop.png');
    expect(r.body.product.imageSource).toBe('SHOP_UPLOAD');
    expect(calls.off).toEqual([]);
  });

  it('TEST 17: طلب قديم يبقى سليمًا عند إضافة الصورة لاحقًا', async () => {
    const p = await prisma.product.create({ data: { barcode: BARCODE, name: 'Coca', unit: '1L' } });
    const l = await prisma.shopProduct.create({ data: { shopId: a.shop.id, productId: p.id, price: 100 } });
    const customer = await createCustomer();
    const order = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({ shopId: a.shop.id, addressId: customer.address.id, items: [{ productId: l.id, quantity: 2 }] });
    expect(order.status).toBe(201);
    const before = await prisma.orderItem.findMany({ where: { orderId: order.body.order.id } });
    await lookup(b); // يضيف الصورة من OFF
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).imageUrl).not.toBeNull();
    const after = await prisma.orderItem.findMany({ where: { orderId: order.body.order.id } });
    expect(after).toEqual(before);
  });

  it('السعر والكمية من المصدر الخارجي لا يُستعملان أبدًا', async () => {
    await lookup(a);
    const p = await prisma.product.findFirstOrThrow();
    expect('price' in p).toBe(false);
    expect(await prisma.shopProduct.count()).toBe(0); // البحث لا ينشئ عرضًا لأي محل
  });

  it('محل غير معتمد: لا مصادر خارجية ولا إنشاء منتج عالمي', async () => {
    const pending = await createShop({ status: 'PENDING' });
    const r = await lookup(pending);
    expect(r.body.status).toBe('NEW');
    expect(calls.off).toEqual([]);
    expect(await prisma.product.count()).toBe(0);
  });

  it('TEST 23 (سباق حقيقي على PostgreSQL): محلات تبحث وتضيف نفس الباركود الجديد معًا → Product واحد', async () => {
    lookupTesting.noDedupe = true; // نعطّل منع التكرار داخل العملية لنختبر قيود قاعدة البيانات نفسها
    setSources(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return offFound();
    }, NOT_FOUND);
    const shops = [a, b, c, ...(await Promise.all([createShop(), createShop(), createShop()]))];
    const results = await Promise.all(shops.map((s) => lookup(s)));
    expect(results.every((r) => r.status === 200 && r.body.status === 'AVAILABLE_TO_ADD')).toBe(true);
    expect(new Set(results.map((r) => r.body.product.id)).size).toBe(1);
    expect(await prisma.product.count({ where: { barcode: BARCODE } })).toBe(1);
    // الملفات المرفوعة من الطلبات الخاسرة حُذفت: ملف واحد يطابق صورة المنتج
    const p = await prisma.product.findFirstOrThrow();
    expect(storage.files.size).toBe(1);
    expect(storage.files.has(storage.pathFromUrl(p.imageUrl!)!)).toBe(true);

    const added = await Promise.all(shops.map((s, i) => add(s, { barcode: BARCODE, price: 100 + i })));
    expect(added.every((r) => r.status === 201)).toBe(true);
    expect(await prisma.shopProduct.count()).toBe(6);
    expect(await prisma.product.count()).toBe(1);
  });

  it('منع التكرار: 5 طلبات متزامنة لنفس الباركود من نفس العملية → استدعاء خارجي واحد', async () => {
    setSources(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return offFound();
    }, NOT_FOUND);
    await Promise.all([a, b, c, a, b].map((s) => lookup(s)));
    expect(calls.off).toHaveLength(1);
    expect(await prisma.product.count()).toBe(1);
  });

  it('ضغط متكرر على باركود غير موجود → لا يتكرر الاستدعاء الخارجي (ذاكرة مؤقتة)', async () => {
    setSources(NOT_FOUND, NOT_FOUND);
    for (let i = 0; i < 5; i++) await lookup(a);
    expect(calls.off).toHaveLength(1);
    expect(calls.upc).toHaveLength(1);
  });

  it('لا تكرار في قاعدة البيانات بعد كل ذلك', async () => {
    await lookup(a);
    await add(a, { barcode: BARCODE, price: 1 });
    await add(b, { barcode: BARCODE, price: 2 });
    const dups = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT (SELECT COUNT(*) FROM (SELECT barcode FROM "Product" WHERE barcode IS NOT NULL GROUP BY barcode HAVING COUNT(*)>1) t)
            + (SELECT COUNT(*) FROM (SELECT "shopId","productId" FROM "ShopProduct" GROUP BY 1,2 HAVING COUNT(*)>1) u) AS n`,
    );
    expect(Number(dups[0]!.n)).toBe(0);
  });
});
