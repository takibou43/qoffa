/**
 * ظهور المنتجات حسب المخزون: ما نفدت كميته (stock = 0) يختفي من واجهة الزبون فقط،
 * ويبقى ظاهرًا للمحل والإدارة، ويعود تلقائيًا عند إعادة التعبئة.
 */
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

let shop: Awaited<ReturnType<typeof createShop>>;
let customer: Awaited<ReturnType<typeof createCustomer>>;

beforeEach(async () => {
  await resetDb();
  shop = await createShop({ isOpen: true });
  customer = await createCustomer();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const customerIds = async () => {
  const res = await request(app).get(`/api/shops/${shop.shop.id}/products`).set(bearer(customer.token));
  expect(res.status).toBe(200);
  return (res.body.items as { id: string }[]).map((p) => p.id);
};

const shopIds = async () => {
  const res = await request(app).get('/api/products').set(bearer(shop.token));
  expect(res.status).toBe(200);
  return (res.body.items as { id: string }[]).map((p) => p.id);
};

const adminIds = async () => {
  const admin = await createAdmin('ADMIN');
  const res = await request(app).get(`/api/admin/shops/${shop.shop.id}/products`).set(bearer(admin.token));
  expect(res.status).toBe(200);
  return (res.body.items as { id: string }[]).map((p) => p.id);
};

const order = (productId: string, quantity: number) =>
  request(app)
    .post('/api/orders')
    .set(bearer(customer.token))
    .send({ shopId: shop.shop.id, addressId: customer.address.id, items: [{ productId, quantity }] });

const setStock = (id: string, stock: number) =>
  request(app).patch(`/api/products/${id}`).set(bearer(shop.token)).send({ stock });

describe('ظهور المنتج للزبون حسب الكمية', () => {
  it('1: منتج بكمية > 0 (أو غير متتبَّعة) يظهر للزبون', async () => {
    const inStock = await createProduct(shop.shop.id, { name: 'حليب', stock: 5 });
    const untracked = await createProduct(shop.shop.id, { name: 'خبز', stock: null });
    const ids = await customerIds();
    expect(ids).toContain(inStock.id);
    expect(ids).toContain(untracked.id);
  });

  it('2+3: منتج بكمية 0 لا يظهر للزبون لكنه يبقى ظاهرًا للمحل والإدارة', async () => {
    const out = await createProduct(shop.shop.id, { name: 'زيت', stock: 0, barcode: '6130000000017' });
    expect(await customerIds()).not.toContain(out.id);
    expect(await shopIds()).toContain(out.id);
    expect(await adminIds()).toContain(out.id);
    // ولا يظهر في مقارنة الأسعار العامة بالباركود
    const cat = await request(app).get('/api/catalog/barcode/6130000000017');
    expect(cat.status).toBe(200);
    expect(cat.body.shops).toHaveLength(0);
  });

  it('4: الـAPI يرفض طلب منتج نفد مخزونه أو كمية غير كافية', async () => {
    const out = await createProduct(shop.shop.id, { stock: 0 });
    const r = await order(out.id, 1);
    expect(r.status).toBe(409);
    const low = await createProduct(shop.shop.id, { stock: 2 });
    expect((await order(low.id, 3)).status).toBe(409);
    expect(await prisma.order.count()).toBe(0);
    const db = await prisma.shopProduct.findUniqueOrThrow({ where: { id: out.id } });
    expect(db.stock).toBe(0);
  });

  it('5+6: يختفي بعد نفاد الكمية بطلب، ويعود بعد إعادة التعبئة', async () => {
    const p = await createProduct(shop.shop.id, { name: 'سكر', stock: 2 });
    expect(await customerIds()).toContain(p.id);

    expect((await order(p.id, 2)).status).toBe(201);
    expect((await prisma.shopProduct.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
    expect(await customerIds()).not.toContain(p.id);
    expect(await shopIds()).toContain(p.id);

    const refill = await setStock(p.id, 10);
    expect(refill.status).toBe(200);
    expect(await customerIds()).toContain(p.id);
    expect((await order(p.id, 1)).status).toBe(201);
  });
});
