import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { TEST_PASSWORD, bearer, createAdmin, createCustomer, resetDb } from './helpers/factories.js';

const app = createApp();

beforeAll(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('المصادقة والأدوار', () => {
  it('ينشئ حساب زبون ويعيد رمزًا', async () => {
    const res = await request(app).post('/api/auth/register/customer').send({
      fullName: 'زبون جديد',
      phone: '0661234567',
      password: 'Secret@123',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(res.body.token).toBeTruthy();
    // لا تُسرَّب كلمة المرور أبدًا
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('يرفض رقم هاتف مكررًا', async () => {
    const res = await request(app).post('/api/auth/register/customer').send({
      fullName: 'زبون آخر',
      phone: '0661234567',
      password: 'Secret@123',
    });
    expect(res.status).toBe(409);
  });

  it('يرفض كلمة مرور قصيرة', async () => {
    const res = await request(app).post('/api/auth/register/customer').send({
      fullName: 'زبون قصير',
      phone: '0661234568',
      password: '123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('password');
  });

  it('لا يسمح بإنشاء SUPER_ADMIN من التسجيل العام', async () => {
    const res = await request(app).post('/api/auth/register/customer').send({
      fullName: 'مخترق',
      phone: '0661234569',
      password: 'Secret@123',
      role: 'SUPER_ADMIN',
    });
    expect(res.status).toBe(201);
    // الدور يُفرض من الخادم بغض النظر عن محتوى الطلب
    expect(res.body.user.role).toBe('CUSTOMER');

    const created = await prisma.user.findUnique({ where: { phone: '0661234569' } });
    expect(created?.role).toBe('CUSTOMER');
  });

  it('لا يوجد أي مسار عام لإنشاء حساب إداري', async () => {
    for (const path of ['/api/auth/register/admin', '/api/auth/register/super-admin']) {
      const res = await request(app).post(path).send({});
      expect(res.status).toBe(404);
    }
  });

  it('يسجّل الدخول ويعيد /me', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ phone: '0661234567', password: 'Secret@123' });
    expect(login.status).toBe(200);

    const me = await request(app).get('/api/auth/me').set(bearer(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user.phone).toBe('0661234567');
  });

  it('يرفض كلمة مرور خاطئة برسالة لا تكشف وجود الحساب', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ phone: '0661234567', password: 'WrongPass1' });
    expect(res.status).toBe(401);

    const missing = await request(app)
      .post('/api/auth/login')
      .send({ phone: '0669999999', password: 'WrongPass1' });
    expect(missing.status).toBe(401);
    expect(missing.body.error.message).toBe(res.body.error.message);
  });

  it('يسجّل الدخول بالبريد الإلكتروني (دون حساسية لحالة الأحرف)', async () => {
    const admin = await createAdmin('SUPER_ADMIN');
    const email = admin.user.email!;
    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('SUPER_ADMIN');

    const wrong = await request(app).post('/api/auth/login').send({ email, password: 'WrongPass1' });
    expect(wrong.status).toBe(401);
    const missing = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'WrongPass1' });
    expect(missing.status).toBe(401);
    expect(missing.body.error.message).toBe(wrong.body.error.message);
  });

  it('يرفض الدخول دون هاتف أو بريد، أو بهما معًا', async () => {
    expect((await request(app).post('/api/auth/login').send({ password: 'x' })).status).toBe(400);
    expect(
      (await request(app).post('/api/auth/login').send({ phone: '0661234567', email: 'a@b.co', password: 'x' }))
        .status,
    ).toBe(400);
  });

  it('يرفض الطلبات بدون رمز أو برمز غير صالح', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(bearer('abc.def.ghi'))).status).toBe(401);
  });

  it('يمنع الحساب المعلّق فورًا حتى برمز صالح', async () => {
    const customer = await createCustomer();
    expect((await request(app).get('/api/auth/me').set(bearer(customer.token))).status).toBe(200);

    await prisma.user.update({ where: { id: customer.user.id }, data: { status: 'SUSPENDED' } });

    const after = await request(app).get('/api/auth/me').set(bearer(customer.token));
    expect(after.status).toBe(403);
  });

  it('يغيّر كلمة المرور ويلغي علامة الإجبار', async () => {
    const admin = await createAdmin();
    await prisma.user.update({
      where: { id: admin.user.id },
      data: { mustChangePassword: true },
    });

    const res = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(admin.token))
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'BrandNew@99' });
    expect(res.status).toBe(200);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } });
    expect(updated.mustChangePassword).toBe(false);

    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ phone: admin.phone, password: 'BrandNew@99' });
    expect(relogin.status).toBe(200);
  });

  it('يرفض تغيير كلمة المرور بكلمة حالية خاطئة', async () => {
    const admin = await createAdmin();
    const res = await request(app)
      .post('/api/auth/change-password')
      .set(bearer(admin.token))
      .send({ currentPassword: 'NotTheRightOne', newPassword: 'BrandNew@99' });
    expect(res.status).toBe(401);
  });
});

describe('طلبات مشوّهة', () => {
  it('JSON غير صالح يعيد 400 لا 500', async () => {
    const res = await request(createApp())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{phone:0550000000,password:x}');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
