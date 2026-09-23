import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { createOrder, transitionOrder } from '../src/modules/orders/orders.service.js';
import { bearer, createCustomer, createProduct, createShop, resetDb } from './helpers/factories.js';

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

const stockOf = async (id: string) =>
  (await prisma.shopProduct.findUniqueOrThrow({ where: { id }, select: { stock: true } })).stock;

const order = (
  items: { productId: string; quantity: number }[],
  extra: Record<string, unknown> = {},
  token = customer.token,
  addressId = customer.address.id,
) =>
  request(app)
    .post('/api/orders')
    .set(bearer(token))
    .send({ shopId: shop.shop.id, addressId, items, ...extra });

describe('خصم المخزون عند إنشاء الطلب', () => {
  it('يخصم الكمية المتوفرة ويُبقي السعر من ShopProduct', async () => {
    const p = await createProduct(shop.shop.id, { name: 'حليب', price: 120, stock: 10 });
    const res = await order([{ productId: p.id, quantity: 3 }]);
    expect(res.status).toBe(201);
    expect(res.body.order.subtotal).toBe(360);
    expect(await stockOf(p.id)).toBe(7);

    const dbOrder = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.order.id },
      include: { items: true },
    });
    expect(dbOrder.stockReserved).toBe(true);
    expect(dbOrder.items[0]!.reservedQty).toBe(3);
  });

  it('يسمح بطلب كل المخزون بالضبط فيصبح صفرًا', async () => {
    const p = await createProduct(shop.shop.id, { stock: 4 });
    const res = await order([{ productId: p.id, quantity: 4 }]);
    expect(res.status).toBe(201);
    expect(await stockOf(p.id)).toBe(0);
  });

  it('يرفض كمية أكبر من المخزون برسالة واضحة ولا يغيّر شيئًا', async () => {
    const p = await createProduct(shop.shop.id, { name: 'سكر', stock: 2 });
    const other = await createProduct(shop.shop.id, { name: 'قهوة', stock: 5 });
    const res = await order([
      { productId: other.id, quantity: 1 },
      { productId: p.id, quantity: 3 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('سكر');
    expect(res.body.error.message).toContain('2');
    expect(await stockOf(p.id)).toBe(2);
    expect(await stockOf(other.id)).toBe(5);
    expect(await prisma.order.count()).toBe(0);
  });

  it('يرفض الطلب عند نفاد المخزون (صفر)', async () => {
    const p = await createProduct(shop.shop.id, { name: 'زيت', stock: 0 });
    const res = await order([{ productId: p.id, quantity: 1 }]);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('نفدت');
    expect(await stockOf(p.id)).toBe(0);
  });

  it('يجمع الكميات المكررة قبل المقارنة بالمخزون', async () => {
    const p = await createProduct(shop.shop.id, { stock: 3 });
    const res = await order([
      { productId: p.id, quantity: 2 },
      { productId: p.id, quantity: 2 },
    ]);
    expect(res.status).toBe(409);
    expect(await stockOf(p.id)).toBe(3);
  });

  it('لا يخصم من منتج مخزونه غير متتبَّع (null)', async () => {
    const p = await createProduct(shop.shop.id, { stock: null });
    const res = await order([{ productId: p.id, quantity: 50 }]);
    expect(res.status).toBe(201);
    expect(await stockOf(p.id)).toBeNull();
    const dbOrder = await prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } });
    expect(dbOrder.stockReserved).toBe(false);
  });

  it('قاعدة البيانات نفسها تمنع المخزون السالب', async () => {
    const p = await createProduct(shop.shop.id, { stock: 1 });
    await expect(
      prisma.shopProduct.update({ where: { id: p.id }, data: { stock: { decrement: 2 } } }),
    ).rejects.toThrow();
    expect(await stockOf(p.id)).toBe(1);
  });
});

describe('الطلبات المتزامنة', () => {
  it('زبونان يطلبان آخر قطعة في نفس اللحظة: ينجح واحد فقط', async () => {
    const p = await createProduct(shop.shop.id, { stock: 1 });
    const other = await createCustomer();
    const results = await Promise.allSettled([
      createOrder(customer.user.id, {
        shopId: shop.shop.id,
        addressId: customer.address.id,
        items: [{ productId: p.id, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
      }),
      createOrder(other.user.id, {
        shopId: shop.shop.id,
        addressId: other.address.id,
        items: [{ productId: p.id, quantity: 1 }],
        paymentMethod: 'CASH_ON_DELIVERY',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await stockOf(p.id)).toBe(0);
    expect(await prisma.order.count()).toBe(1);
  });

  it('عشرة طلبات متزامنة على مخزون 5: خمسة فقط تنجح والمخزون لا يصبح سالبًا', async () => {
    const p = await createProduct(shop.shop.id, { stock: 5 });
    const customers = await Promise.all(Array.from({ length: 10 }, () => createCustomer()));
    const results = await Promise.allSettled(
      customers.map((c) =>
        createOrder(c.user.id, {
          shopId: shop.shop.id,
          addressId: c.address.id,
          items: [{ productId: p.id, quantity: 1 }],
          paymentMethod: 'CASH_ON_DELIVERY',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(await stockOf(p.id)).toBe(0);
    expect(await prisma.order.count()).toBe(5);
  });
});

describe('عدم الخصم مرتين', () => {
  it('إعادة إرسال نفس الطلب بنفس المفتاح تعيد نفس الطلب دون خصم ثانٍ', async () => {
    const p = await createProduct(shop.shop.id, { stock: 10 });
    const key = 'checkout-key-123456';
    const first = await order([{ productId: p.id, quantity: 2 }], { clientRequestId: key });
    const retry = await order([{ productId: p.id, quantity: 2 }], { clientRequestId: key });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.order.id).toBe(first.body.order.id);
    expect(await stockOf(p.id)).toBe(8);
    expect(await prisma.order.count()).toBe(1);
  });

  it('إرسالان متزامنان بنفس المفتاح: طلب واحد وخصم واحد', async () => {
    const p = await createProduct(shop.shop.id, { stock: 10 });
    const input = {
      shopId: shop.shop.id,
      addressId: customer.address.id,
      items: [{ productId: p.id, quantity: 3 }],
      paymentMethod: 'CASH_ON_DELIVERY' as const,
      clientRequestId: 'same-key-concurrent-1',
    };
    const [a, b] = await Promise.all([
      createOrder(customer.user.id, input),
      createOrder(customer.user.id, input),
    ]);
    expect(a.id).toBe(b.id);
    expect(await stockOf(p.id)).toBe(7);
    expect(await prisma.order.count()).toBe(1);
  });

  it('نفس المفتاح لزبون آخر لا يعيد طلب غيره', async () => {
    const p = await createProduct(shop.shop.id, { stock: 10 });
    const other = await createCustomer();
    const key = 'shared-key-abcdef';
    const mine = await order([{ productId: p.id, quantity: 1 }], { clientRequestId: key });
    const theirs = await order(
      [{ productId: p.id, quantity: 1 }],
      { clientRequestId: key },
      other.token,
      other.address.id,
    );
    expect(theirs.status).toBe(201);
    expect(theirs.body.order.id).not.toBe(mine.body.order.id);
    expect(await stockOf(p.id)).toBe(8);
  });

  it('انتقالات الحالة العادية لا تخصم المخزون مرة أخرى', async () => {
    const p = await createProduct(shop.shop.id, { stock: 10 });
    const res = await order([{ productId: p.id, quantity: 2 }]);
    const id = res.body.order.id;
    await transitionOrder(id, 'SHOP_ACCEPTED', { actorType: 'SHOP' });
    await transitionOrder(id, 'PREPARING', { actorType: 'SHOP' });
    await transitionOrder(id, 'READY_FOR_PICKUP', { actorType: 'SHOP' });
    expect(await stockOf(p.id)).toBe(8);
  });
});

describe('إعادة المخزون عند الرفض/الإلغاء', () => {
  it('إلغاء الزبون يعيد الكمية مرة واحدة فقط', async () => {
    const p = await createProduct(shop.shop.id, { stock: 5 });
    const res = await order([{ productId: p.id, quantity: 2 }]);
    const id = res.body.order.id;
    expect(await stockOf(p.id)).toBe(3);

    const cancel = await request(app)
      .post(`/api/orders/${id}/cancel`)
      .set(bearer(customer.token))
      .send({});
    expect(cancel.status).toBe(200);
    expect(await stockOf(p.id)).toBe(5);

    // محاولة ثانية: الطلب نهائي → 409 والمخزون لا يزيد
    const again = await request(app)
      .post(`/api/orders/${id}/cancel`)
      .set(bearer(customer.token))
      .send({});
    expect(again.status).toBe(409);
    expect(await stockOf(p.id)).toBe(5);
  });

  it('رفض المحل يعيد الكمية', async () => {
    const p = await createProduct(shop.shop.id, { stock: 5 });
    const res = await order([{ productId: p.id, quantity: 4 }]);
    const rejected = await request(app)
      .post(`/api/orders/${res.body.order.id}/reject`)
      .set(bearer(shop.token))
      .send({ reason: 'نفدت الكمية' });
    expect(rejected.status).toBe(200);
    expect(await stockOf(p.id)).toBe(5);
  });

  it('إلغاءان متزامنان لنفس الطلب يعيدان الكمية مرة واحدة', async () => {
    const p = await createProduct(shop.shop.id, { stock: 5 });
    const res = await order([{ productId: p.id, quantity: 2 }]);
    const id = res.body.order.id;
    await Promise.allSettled([
      transitionOrder(id, 'CANCELLED', { actorType: 'ADMIN' }),
      transitionOrder(id, 'CANCELLED', { actorType: 'ADMIN' }),
    ]);
    expect(await stockOf(p.id)).toBe(5);
  });

  it('الإلغاء بعد استلام الموصّل للبضاعة لا يعيدها للمخزون', async () => {
    const p = await createProduct(shop.shop.id, { stock: 5 });
    const res = await order([{ productId: p.id, quantity: 2 }]);
    const id = res.body.order.id;
    await prisma.order.update({ where: { id }, data: { status: 'PICKED_UP' } });
    await transitionOrder(id, 'CANCELLED', { actorType: 'ADMIN' });
    expect(await stockOf(p.id)).toBe(3);
  });

  it('طلب قديم بلا حجز (قبل الميزة) لا يضيف مخزونًا وهميًا عند إلغائه', async () => {
    const p = await createProduct(shop.shop.id, { stock: 5 });
    const res = await order([{ productId: p.id, quantity: 2 }]);
    const id = res.body.order.id;
    // محاكاة طلب أُنشئ قبل هذه الميزة
    await prisma.order.update({ where: { id }, data: { stockReserved: false } });
    await prisma.orderItem.updateMany({ where: { orderId: id }, data: { reservedQty: 0 } });
    await transitionOrder(id, 'CANCELLED', { actorType: 'ADMIN' });
    expect(await stockOf(p.id)).toBe(3);
  });

  it('منتج صار غير متتبَّع بعد الطلب لا يتحوّل إلى رقم عند الإلغاء', async () => {
    const p = await createProduct(shop.shop.id, { stock: 5 });
    const res = await order([{ productId: p.id, quantity: 2 }]);
    await prisma.shopProduct.update({ where: { id: p.id }, data: { stock: null } });
    await transitionOrder(res.body.order.id, 'CANCELLED', { actorType: 'ADMIN' });
    expect(await stockOf(p.id)).toBeNull();
  });
});

describe('إخفاء المنتجات النافدة عن الزبون', () => {
  const customerNames = async () => {
    const res = await request(app).get(`/api/shops/${shop.shop.id}/products?limit=50`);
    expect(res.status).toBe(200);
    return (res.body.items as { name: string }[]).map((p) => p.name);
  };

  it('stock = 0 لا يظهر للزبون، وstock > 0 أو غير متتبَّع يظهر', async () => {
    await createProduct(shop.shop.id, { name: 'نافد', stock: 0 });
    await createProduct(shop.shop.id, { name: 'متوفر', stock: 3 });
    await createProduct(shop.shop.id, { name: 'غير متتبع', stock: null });
    const names = await customerNames();
    expect(names).not.toContain('نافد');
    expect(names).toContain('متوفر');
    expect(names).toContain('غير متتبع');
  });

  it('يبقى ظاهرًا للمحل، ويعود للزبون عند إعادة التعبئة', async () => {
    const p = await createProduct(shop.shop.id, { name: 'زيت نافد', stock: 0 });
    const mine = await request(app).get('/api/products?limit=50').set(bearer(shop.token));
    expect(mine.status).toBe(200);
    expect((mine.body.items as { id: string }[]).some((i) => i.id === p.id)).toBe(true);

    expect(await customerNames()).not.toContain('زيت نافد');
    await prisma.shopProduct.update({ where: { id: p.id }, data: { stock: 5 } });
    expect(await customerNames()).toContain('زيت نافد');
  });

  it('نفاد المخزون بعد طلب يخفي المنتج مباشرة', async () => {
    const p = await createProduct(shop.shop.id, { name: 'آخر قطعة', stock: 1 });
    expect((await order([{ productId: p.id, quantity: 1 }])).status).toBe(201);
    expect(await customerNames()).not.toContain('آخر قطعة');
    // ومحاولة الطلب بتجاوز الواجهة تُرفض
    const again = await order([{ productId: p.id, quantity: 1 }]);
    expect(again.status).toBe(409);
  });
});
