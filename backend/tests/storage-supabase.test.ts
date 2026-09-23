import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { SupabaseStorage, isAllowedStorageUrl, setImageStorage } from '../src/lib/storage.js';
import { bearer, createAdmin, createShop, resetDb } from './helpers/factories.js';
import { startFakeSupabaseStorage } from './helpers/fakeSupabaseStorage.js';
import { makePng, makeWebpHeader } from './helpers/images.js';

/**
 * يختبر محوّل Supabase Storage الحقيقي (REST عبر fetch) ضد خادم محلي يحاكي Supabase:
 * Upload → URL → Database → قراءة الرابط العام → Replace → Delete.
 */
const KEY = 'sb_secret_test_key_1234567890abcdef';
let fake: Awaited<ReturnType<typeof startFakeSupabaseStorage>>;
const app = createApp();

beforeAll(async () => {
  fake = await startFakeSupabaseStorage(KEY);
  setImageStorage(new SupabaseStorage(fake.url, KEY, 'product-images'));
  await resetDb();
});

afterAll(async () => {
  setImageStorage(null);
  await fake.close();
  await prisma.$disconnect();
});

describe('محوّل Supabase Storage', () => {
  it('Upload → URL → DB → Read → Replace → Delete', async () => {
    const shop = await createShop();
    const added = await request(app)
      .post('/api/products')
      .set(bearer(shop.token))
      .send({ barcode: '6131234567890', name: 'Coca-Cola 1L', price: 120 });
    const png = makePng();

    // Upload
    const up = await request(app)
      .put(`/api/products/${added.body.product.id}/image`)
      .set(bearer(shop.token))
      .set('Content-Type', 'image/png')
      .send(png);
    expect(up.status).toBe(200);
    const url = up.body.product.imageUrl as string;
    expect(url.startsWith(`${fake.url}/storage/v1/object/public/product-images/products/`)).toBe(true);

    // المفتاح أُرسل في apikey فقط (مفتاح sb_secret ليس JWT)
    const post = fake.requests.find((r) => r.method === 'POST')!;
    expect(post.apikey).toBe(KEY);
    expect(post.auth).toBeUndefined();

    // DB
    const p = await prisma.product.findUniqueOrThrow({ where: { id: added.body.product.productId } });
    expect(p.imageUrl).toBe(url);

    // Read: الرابط العام يعيد نفس البايتات
    const read = await fetch(url);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await read.arrayBuffer()).equals(png)).toBe(true);

    // Replace (إدارة): الجديدة موجودة، والقديمة حُذفت بعد نجاح التحديث
    const admin = await createAdmin('ADMIN');
    const rep = await request(app)
      .put(`/api/admin/products/${p.id}/image`)
      .set(bearer(admin.token))
      .set('Content-Type', 'image/webp')
      .send(makeWebpHeader());
    expect(rep.status).toBe(200);
    const newUrl = rep.body.product.imageUrl as string;
    expect((await fetch(newUrl)).status).toBe(200);
    expect((await fetch(url)).status).toBe(404);

    // Delete
    const del = await request(app).delete(`/api/admin/products/${p.id}/image`).set(bearer(admin.token));
    expect(del.status).toBe(200);
    expect((await fetch(newUrl)).status).toBe(404);
    expect(fake.files.size).toBe(0);
    expect(await prisma.product.count()).toBe(1);
  });

  it('مفتاح خاطئ → 502 واضح ولا يتغير المنتج', async () => {
    await resetDb();
    setImageStorage(new SupabaseStorage(fake.url, 'wrong_key_wrong_key_wrong', 'product-images'));
    try {
      const shop = await createShop();
      const added = await request(app)
        .post('/api/products')
        .set(bearer(shop.token))
        .send({ name: 'خبز', price: 20 });
      const up = await request(app)
        .put(`/api/products/${added.body.product.id}/image`)
        .set(bearer(shop.token))
        .set('Content-Type', 'image/png')
        .send(makePng());
      expect(up.status).toBe(502);
      expect(up.body.error.code).toBe('STORAGE_ERROR');
      const p = await prisma.product.findUniqueOrThrow({ where: { id: added.body.product.productId } });
      expect(p.imageUrl).toBeNull();
    } finally {
      setImageStorage(new SupabaseStorage(fake.url, KEY, 'product-images'));
    }
  });

  it('روابط خارجية لا تُحذف أبدًا، ومسار الملف محصور داخل الدلو', () => {
    const s = new SupabaseStorage('https://abc.supabase.co', KEY, 'product-images');
    expect(s.pathFromUrl('https://abc.supabase.co/storage/v1/object/public/product-images/products/p1/x.webp')).toBe('products/p1/x.webp');
    expect(s.pathFromUrl('https://evil.example/x.webp')).toBeNull();
    expect(s.pathFromUrl('https://abc.supabase.co/storage/v1/object/public/product-images/../secret')).toBeNull();
    expect(s.pathFromUrl('https://abc.supabase.co/storage/v1/object/public/other-bucket/x.webp')).toBeNull();
  });

  it('عنوان التخزين: https فقط (localhost مسموح خارج الإنتاج)', () => {
    expect(isAllowedStorageUrl('https://abc.supabase.co')).toBe(true);
    expect(isAllowedStorageUrl('http://127.0.0.1:5000')).toBe(true);
    expect(isAllowedStorageUrl('http://evil.example')).toBe(false);
    expect(isAllowedStorageUrl('javascript:alert(1)')).toBe(false);
  });
});
