import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

// مسار الإنتاج: غياب JWT_SECRET من البيئة → قراءة المفتاح من إعداد دور PostgreSQL.
const ORIGINAL = process.env.JWT_SECRET;

async function freshJwtModule() {
  vi.resetModules();
  process.env.JWT_SECRET = '';
  return import('../src/lib/jwt.js');
}

afterAll(async () => {
  process.env.JWT_SECRET = ORIGINAL;
  await prisma.$executeRawUnsafe('ALTER ROLE CURRENT_USER RESET qoffa.jwt_secret');
});

describe('مفتاح JWT من إعداد دور قاعدة البيانات', () => {
  it('يرفض العمل إن لم يكن المفتاح مهيأ في أي مكان', async () => {
    await prisma.$executeRawUnsafe('ALTER ROLE CURRENT_USER RESET qoffa.jwt_secret');
    const jwt = await freshJwtModule();
    await expect(jwt.ensureJwtSecret()).rejects.toThrow('غير مهيأ');
    expect(() => jwt.signToken({ sub: 'u1', role: 'CUSTOMER' })).toThrow();
  });

  it('يحمّل المفتاح المولَّد داخل PostgreSQL ويوقّع ويتحقق به', async () => {
    await prisma.$executeRawUnsafe(
      "DO $$ BEGIN EXECUTE format('ALTER ROLE CURRENT_USER SET qoffa.jwt_secret = %L', encode(sha512(random()::text::bytea), 'hex')); END $$",
    );
    const jwt = await freshJwtModule();
    await jwt.ensureJwtSecret();
    const token = jwt.signToken({ sub: 'u1', role: 'CUSTOMER' });
    expect(jwt.verifyToken(token)).toEqual({ sub: 'u1', role: 'CUSTOMER' });
    // رمز موقّع بمفتاح آخر مرفوض
    const forged = (await import('jsonwebtoken')).default.sign({ sub: 'u1', role: 'SUPER_ADMIN' }, 'x'.repeat(40));
    expect(() => jwt.verifyToken(forged)).toThrow();
  });
});
