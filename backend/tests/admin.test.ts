import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import {
  TEST_PASSWORD,
  bearer,
  createAdmin,
  createCustomer,
  createDriver,
  createShop,
  resetDb,
} from './helpers/factories.js';

const app = createApp();

let superAdmin: Awaited<ReturnType<typeof createAdmin>>;
let admin: Awaited<ReturnType<typeof createAdmin>>;
let customer: Awaited<ReturnType<typeof createCustomer>>;
let shop: Awaited<ReturnType<typeof createShop>>;
let driver: Awaited<ReturnType<typeof createDriver>>;

beforeEach(async () => {
  await resetDb();
  superAdmin = await createAdmin('SUPER_ADMIN');
  admin = await createAdmin('ADMIN');
  customer = await createCustomer();
  shop = await createShop({ status: 'PENDING' });
  driver = await createDriver({ status: 'PENDING', isAvailable: false });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('حماية لوحة الإدارة', () => {
  it('يمنع غير الإداريين من كل مسارات الإدارة', async () => {
    const paths = ['/api/admin/stats', '/api/admin/users', '/api/admin/shops', '/api/admin/orders'];
    for (const token of [customer.token, shop.token, driver.token]) {
      for (const path of paths) {
        expect((await request(app).get(path).set(bearer(token))).status, path).toBe(403);
      }
    }
  });

  it('يمنع الوصول بدون مصادقة', async () => {
    expect((await request(app).get('/api/admin/stats')).status).toBe(401);
  });

  it('يسمح للمدير ولمالك المنصة', async () => {
    for (const token of [admin.token, superAdmin.token]) {
      expect((await request(app).get('/api/admin/stats').set(bearer(token))).status).toBe(200);
    }
  });
});

describe('حماية دور مالك المنصة (SUPER_ADMIN)', () => {
  it('لا يمكن إنشاء SUPER_ADMIN من أي مسار — حتى لمالك المنصة', async () => {
    const res = await request(app)
      .post('/api/admin/admins')
      .set(bearer(superAdmin.token))
      .send({
        fullName: 'مدير جديد',
        phone: '0559998877',
        email: 'newadmin@test.local',
        password: 'StrongPass@123',
        role: 'SUPER_ADMIN',
      });
    expect(res.status).toBe(201);
    // الدور يُفرض في الخادم
    expect(res.body.user.role).toBe('ADMIN');

    const created = await prisma.user.findUniqueOrThrow({ where: { phone: '0559998877' } });
    expect(created.role).toBe('ADMIN');
    expect(created.mustChangePassword).toBe(true);
  });

  it('المدير العادي لا يستطيع إنشاء مدراء', async () => {
    const res = await request(app)
      .post('/api/admin/admins')
      .set(bearer(admin.token))
      .send({
        fullName: 'مدير مهرّب',
        phone: '0559998878',
        email: 'sneaky@test.local',
        password: 'StrongPass@123',
      });
    expect(res.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { phone: '0559998878' } })).toBeNull();
  });

  it('لا أحد يستطيع تعليق حساب مالك المنصة', async () => {
    for (const token of [admin.token, superAdmin.token]) {
      const res = await request(app)
        .patch(`/api/admin/users/${superAdmin.user.id}/status`)
        .set(bearer(token))
        .send({ status: 'SUSPENDED' });
      expect([400, 403]).toContain(res.status);
    }
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: superAdmin.user.id } });
    expect(owner.status).toBe('ACTIVE');
    expect(owner.role).toBe('SUPER_ADMIN');
  });

  it('المدير العادي لا يستطيع تعليق مدير آخر', async () => {
    const other = await createAdmin('ADMIN');
    const res = await request(app)
      .patch(`/api/admin/users/${other.user.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(403);
  });

  it('مالك المنصة يستطيع تعليق مدير عادي', async () => {
    const other = await createAdmin('ADMIN');
    const res = await request(app)
      .patch(`/api/admin/users/${other.user.id}/status`)
      .set(bearer(superAdmin.token))
      .send({ status: 'SUSPENDED', reason: 'مخالفة' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('SUSPENDED');
  });

  it('لا يمكن إزالة مالك المنصة', async () => {
    const res = await request(app)
      .delete(`/api/admin/admins/${superAdmin.user.id}`)
      .set(bearer(superAdmin.token));
    expect(res.status).toBe(403);
  });

  it('العمليات المخصّصة لمالك المنصة محجوبة عن المدير العادي', async () => {
    const commission = await request(app)
      .patch(`/api/admin/shops/${shop.shop.id}/commission`)
      .set(bearer(admin.token))
      .send({ commissionBps: 500 });
    expect(commission.status).toBe(403);

    const setting = await request(app)
      .put('/api/admin/settings/platform.commissionBps')
      .set(bearer(admin.token))
      .send({ value: 500 });
    expect(setting.status).toBe(403);
  });

  it('لا يعرض بريد المالك إلا في لوحة الإدارة', async () => {
    const res = await request(app).get('/api/admin/platform').set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.platform.name).toBe('قُفّة');

    // المسارات العامة لا تحتوي بريد المالك إطلاقًا
    const publicShops = await request(app).get('/api/shops');
    expect(JSON.stringify(publicShops.body)).not.toContain('@');
  });
});

describe('إدارة المحلات والموصّلين', () => {
  it('يعتمد محلًا ويُشعر صاحبه ويسجّل العملية', async () => {
    const res = await request(app)
      .patch(`/api/admin/shops/${shop.shop.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body.shop.status).toBe('APPROVED');

    const notif = await prisma.notification.findFirst({
      where: { userId: shop.owner.id, type: 'ACCOUNT_APPROVED' },
    });
    expect(notif).not.toBeNull();

    const log = await prisma.adminAuditLog.findFirst({
      where: { targetType: 'shop', targetId: shop.shop.id },
    });
    expect(log?.action).toBe('SHOP_APPROVED');
    expect(log?.actorId).toBe(admin.user.id);
  });

  it('تعليق محل يغلقه فورًا', async () => {
    await request(app)
      .patch(`/api/admin/shops/${shop.shop.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'APPROVED' });
    await prisma.shop.update({ where: { id: shop.shop.id }, data: { isOpen: true } });

    await request(app)
      .patch(`/api/admin/shops/${shop.shop.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'SUSPENDED', reason: 'شكاوى' });

    const updated = await prisma.shop.findUniqueOrThrow({ where: { id: shop.shop.id } });
    expect(updated.status).toBe('SUSPENDED');
    expect(updated.isOpen).toBe(false);
  });

  it('يعتمد موصّلًا ويعلّقه', async () => {
    const approve = await request(app)
      .patch(`/api/admin/drivers/${driver.profile.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'APPROVED' });
    expect(approve.status).toBe(200);

    await prisma.driverProfile.update({
      where: { id: driver.profile.id },
      data: { isAvailable: true },
    });

    await request(app)
      .patch(`/api/admin/drivers/${driver.profile.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'SUSPENDED' });

    const updated = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: driver.profile.id },
    });
    expect(updated.status).toBe('SUSPENDED');
    expect(updated.isAvailable).toBe(false);
  });

  it('تعليق حساب صاحب محل يغلق محله ويمنع دخوله', async () => {
    const approved = await createShop({ status: 'APPROVED', isOpen: true });
    await request(app)
      .patch(`/api/admin/users/${approved.owner.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'SUSPENDED' });

    const updatedShop = await prisma.shop.findUniqueOrThrow({ where: { id: approved.shop.id } });
    expect(updatedShop.isOpen).toBe(false);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: approved.phone, password: TEST_PASSWORD });
    expect(login.status).toBe(403);
  });

  it('المدير لا يستطيع تعليق حسابه', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${admin.user.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'SUSPENDED' });
    expect(res.status).toBe(400);
  });
});

describe('العمولات والمحافظ والإعدادات', () => {
  it('مالك المنصة يغيّر عمولة محل ويُسجَّل التغيير', async () => {
    const res = await request(app)
      .patch(`/api/admin/shops/${shop.shop.id}/commission`)
      .set(bearer(superAdmin.token))
      .send({ commissionBps: 750 });
    expect(res.status).toBe(200);
    expect(res.body.shop.commissionBps).toBe(750);

    const log = await prisma.adminAuditLog.findFirst({
      where: { action: 'SHOP_COMMISSION_CHANGED' },
    });
    expect((log?.metadata as { from: number; to: number }).to).toBe(750);
  });

  it('يرفض عمولة خارج المدى', async () => {
    const res = await request(app)
      .patch(`/api/admin/shops/${shop.shop.id}/commission`)
      .set(bearer(superAdmin.token))
      .send({ commissionBps: 9000 });
    expect(res.status).toBe(400);
  });

  it('تعديل المحفظة يتطلب سببًا ويُسجَّل ويُنشئ حركة', async () => {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { shopId: shop.shop.id } });

    const noReason = await request(app)
      .post(`/api/admin/wallets/${wallet.id}/adjust`)
      .set(bearer(superAdmin.token))
      .send({ amount: 500 });
    expect(noReason.status).toBe(400);

    const res = await request(app)
      .post(`/api/admin/wallets/${wallet.id}/adjust`)
      .set(bearer(superAdmin.token))
      .send({ amount: 500, description: 'تسوية يدوية' });
    expect(res.status).toBe(200);
    expect(res.body.wallet.balance).toBe(500);

    const tx = await prisma.walletTransaction.findFirstOrThrow({ where: { walletId: wallet.id } });
    expect(tx.type).toBe('ADJUSTMENT');
    expect(tx.amount).toBe(500);

    const log = await prisma.adminAuditLog.findFirst({ where: { action: 'WALLET_ADJUSTED' } });
    expect(log).not.toBeNull();
  });

  it('المدير العادي لا يعدّل المحافظ', async () => {
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { shopId: shop.shop.id } });
    const res = await request(app)
      .post(`/api/admin/wallets/${wallet.id}/adjust`)
      .set(bearer(admin.token))
      .send({ amount: 500, description: 'محاولة' });
    expect(res.status).toBe(403);
  });

  it('مالك المنصة يغيّر إعدادًا ويُسجَّل', async () => {
    const res = await request(app)
      .put('/api/admin/settings/platform.commissionBps')
      .set(bearer(superAdmin.token))
      .send({ value: 1200, label: 'عمولة المنصة' });
    expect(res.status).toBe(200);
    expect(res.body.setting.value).toBe(1200);

    const log = await prisma.adminAuditLog.findFirst({ where: { action: 'SETTING_CHANGED' } });
    expect(log?.targetId).toBe('platform.commissionBps');
  });
});

describe('سجل العمليات الإدارية', () => {
  it('يسجّل الفاعل والهدف ويكون للقراءة فقط', async () => {
    await request(app)
      .patch(`/api/admin/shops/${shop.shop.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'APPROVED' });

    const res = await request(app).get('/api/admin/audit-log').set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].actor.id).toBe(admin.user.id);

    // لا يوجد أي مسار لحذف أو تعديل السجل
    const logId = res.body.items[0].id as string;
    for (const method of ['delete', 'patch', 'put'] as const) {
      const attempt = await request(app)[method](`/api/admin/audit-log/${logId}`).set(
        bearer(superAdmin.token),
      );
      expect(attempt.status).toBe(404);
    }
  });
});

describe('إحصائيات المنصة', () => {
  it('يعيد الأرقام الأساسية', async () => {
    const res = await request(app).get('/api/admin/stats').set(bearer(admin.token));
    expect(res.status).toBe(200);
    const s = res.body.stats;
    expect(s.customers).toBeGreaterThanOrEqual(1);
    expect(s.pendingShops).toBeGreaterThanOrEqual(1);
    expect(s.pendingDrivers).toBeGreaterThanOrEqual(1);
    expect(s).toHaveProperty('platformCommission');
    expect(s).toHaveProperty('grossRevenue');
  });
});
