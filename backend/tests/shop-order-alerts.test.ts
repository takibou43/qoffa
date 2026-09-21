import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  bearer,
  createCustomer,
  createProduct,
  createShop,
  resetDb,
} from './helpers/factories.js';

/**
 * عقد الخادم لنظام تنبيه الطلبات: مصدر الحقيقة = الطلبات PENDING في قاعدة البيانات.
 * الواجهة تقرأ GET /api/orders/shop?bucket=new وتُنبّه ما دام فيه شيء.
 */
const app = createApp();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('مصدر الحقيقة لتنبيه الطلبات (الخادم + قاعدة البيانات)', () => {
  let shop: Awaited<ReturnType<typeof createShop>>;
  let other: Awaited<ReturnType<typeof createShop>>;
  let customer: Awaited<ReturnType<typeof createCustomer>>;
  let productId: string;

  beforeEach(async () => {
    await resetDb();
    shop = await createShop();
    other = await createShop();
    customer = await createCustomer();
    productId = (await createProduct(shop.shop.id, { price: 100 })).id;
  });

  const place = async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(bearer(customer.token))
      .send({
        shopId: shop.shop.id,
        addressId: customer.address.id,
        items: [{ productId, quantity: 1 }],
      });
    expect(res.status).toBe(201);
    return res.body.order.id as string;
  };

  const pending = async () => {
    const res = await request(app)
      .get('/api/orders/shop')
      .query({ bucket: 'new', limit: 50 })
      .set(bearer(shop.token));
    expect(res.status).toBe(200);
    return (res.body.items as { id: string; status: string }[]).map((o) => o);
  };

  it('طلب جديد يظهر PENDING، والقراءة المتكررة (Refresh/فتح التفاصيل) لا تغيّره ولا تكرّره', async () => {
    const id = await place();
    for (let i = 0; i < 3; i++) {
      const list = await pending();
      expect(list.map((o) => o.id)).toEqual([id]);
      expect(list[0]!.status).toBe('PENDING');
      const detail = await request(app).get(`/api/orders/${id}`).set(bearer(shop.token));
      expect(detail.status).toBe(200);
      expect(detail.body.order.status).toBe('PENDING');
    }
    expect(await prisma.order.count()).toBe(1);
  });

  it('القبول الناجح يُخرج الطلب من قائمة الانتظار', async () => {
    const id = await place();
    const res = await request(app).post(`/api/orders/${id}/accept`).set(bearer(shop.token));
    expect(res.status).toBe(200);
    expect(await pending()).toEqual([]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).not.toBe('PENDING');
  });

  it('الرفض الناجح يُخرج الطلب من قائمة الانتظار (REJECTED)', async () => {
    const id = await place();
    const res = await request(app)
      .post(`/api/orders/${id}/reject`)
      .set(bearer(shop.token))
      .send({ reason: 'غير متوفر' });
    expect(res.status).toBe(200);
    expect(await pending()).toEqual([]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('REJECTED');
  });

  it('فشل القبول/الرفض (محل آخر، رفض بلا سبب، بلا توثيق) يُبقي الطلب PENDING', async () => {
    const id = await place();

    const foreign = await request(app).post(`/api/orders/${id}/accept`).set(bearer(other.token));
    expect([403, 404]).toContain(foreign.status);
    const anon = await request(app).post(`/api/orders/${id}/accept`);
    expect(anon.status).toBe(401);
    const noReason = await request(app)
      .post(`/api/orders/${id}/reject`)
      .set(bearer(shop.token))
      .send({});
    expect(noReason.status).toBe(400);
    const otherReject = await request(app)
      .post(`/api/orders/${id}/reject`)
      .set(bearer(other.token))
      .send({ reason: 'المنتجات غير متوفرة' });
    expect([403, 404]).toContain(otherReject.status);

    const list = await pending();
    expect(list.map((o) => o.id)).toEqual([id]); // ما زال غير معالج → التنبيه يستمر
  });

  it('لا يمكن معالجة الطلب مرتين (409) ولا تظهر تكرارات', async () => {
    const id = await place();
    expect((await request(app).post(`/api/orders/${id}/accept`).set(bearer(shop.token))).status).toBe(200);
    const again = await request(app).post(`/api/orders/${id}/accept`).set(bearer(shop.token));
    expect(again.status).toBe(409);
    const rejectAfter = await request(app)
      .post(`/api/orders/${id}/reject`)
      .set(bearer(shop.token))
      .send({ reason: 'المنتجات غير متوفرة' });
    // آلة الحالات تسمح للمحل بإلغاء طلب قبله (SHOP_ACCEPTED→REJECTED) — المهم أنه لا يعود PENDING أبدًا
    expect([200, 409]).toContain(rejectAfter.status);
    expect(await pending()).toEqual([]);
    expect(await prisma.order.count({ where: { status: 'PENDING' } })).toBe(0);
  });

  it('3 طلبات: قبول #1 ثم رفض #2 ثم قبول #3 → 2 ثم 1 ثم 0 في قاعدة البيانات', async () => {
    const ids = [await place(), await place(), await place()];
    expect((await pending()).length).toBe(3);

    await request(app).post(`/api/orders/${ids[0]}/accept`).set(bearer(shop.token));
    expect((await pending()).map((o) => o.id).sort()).toEqual([ids[1]!, ids[2]!].sort());

    await request(app)
      .post(`/api/orders/${ids[1]}/reject`)
      .set(bearer(shop.token))
      .send({ reason: 'المنتجات غير متوفرة' });
    expect((await pending()).map((o) => o.id)).toEqual([ids[2]]);

    await request(app).post(`/api/orders/${ids[2]}/accept`).set(bearer(shop.token));
    expect(await pending()).toEqual([]);

    // قاعدة البيانات: معرّفات فريدة، لا PENDING متبقٍ، ولا طلبات إضافية أُنشئت
    const dup = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM (SELECT id FROM "Order" GROUP BY id HAVING COUNT(*) > 1) t`,
    );
    expect(Number(dup[0]!.n)).toBe(0);
    expect(await prisma.order.count()).toBe(3);
    expect(await prisma.order.count({ where: { status: 'PENDING' } })).toBe(0);
    expect(await prisma.order.count({ where: { status: 'REJECTED' } })).toBe(1);
  });

  it('المحل لا يرى طلبات PENDING لمحل آخر', async () => {
    await place();
    const res = await request(app)
      .get('/api/orders/shop')
      .query({ bucket: 'new', limit: 50 })
      .set(bearer(other.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('أكثر من 50 طلبًا معلّقًا: الترقيم يعيد الكل عبر الصفحات بلا تكرار', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await place());
    const p1 = await request(app)
      .get('/api/orders/shop')
      .query({ bucket: 'new', limit: 2, page: 1 })
      .set(bearer(shop.token));
    const p2 = await request(app)
      .get('/api/orders/shop')
      .query({ bucket: 'new', limit: 2, page: 2 })
      .set(bearer(shop.token));
    expect(p1.body.meta.hasNext).toBe(true);
    expect(p2.body.meta.hasNext).toBe(false);
    const all = [...p1.body.items, ...p2.body.items].map((o: { id: string }) => o.id);
    expect(new Set(all).size).toBe(3);
    expect(all.sort()).toEqual([...ids].sort());
  });
});
