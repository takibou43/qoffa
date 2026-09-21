import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

// مسار الإنتاج: غياب JWT_SECRET من البيئة → قراءة المفتاح من qoffa_private.app_secret.
const ORIGINAL = process.env.JWT_SECRET;

async function freshJwtModule() {
  vi.resetModules();
  process.env.JWT_SECRET = '';
  return import('../src/lib/jwt.js');
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS qoffa_private');
  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS qoffa_private.app_secret (key text PRIMARY KEY, value text NOT NULL CHECK (length(value) >= 32), created_at timestamptz NOT NULL DEFAULT now())',
  );
});

afterAll(async () => {
  process.env.JWT_SECRET = ORIGINAL;
  await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS qoffa_private CASCADE');
});

describe('مفتاح JWT من قاعدة البيانات', () => {
  it('يرفض العمل إن لم يكن المفتاح مهيأ في أي مكان', async () => {
    await prisma.$executeRawUnsafe('DELETE FROM qoffa_private.app_secret');
    const jwt = await freshJwtModule();
    await expect(jwt.ensureJwtSecret()).rejects.toThrow('غير مهيأ');
    expect(() => jwt.signToken({ sub: 'u1', role: 'CUSTOMER' })).toThrow();
  });

  it('يحمّل المفتاح المولَّد داخل PostgreSQL ويوقّع ويتحقق به', async () => {
    await prisma.$executeRawUnsafe(
      "INSERT INTO qoffa_private.app_secret (key, value) SELECT 'jwt_secret', encode(sha512(random()::text::bytea), 'hex')",
    );
    const jwt = await freshJwtModule();
    await jwt.ensureJwtSecret();
    const token = jwt.signToken({ sub: 'u1', role: 'CUSTOMER' });
    expect(jwt.verifyToken(token)).toEqual({ sub: 'u1', role: 'CUSTOMER' });
    const forged = (await import('jsonwebtoken')).default.sign({ sub: 'u1', role: 'SUPER_ADMIN' }, 'x'.repeat(40));
    expect(() => jwt.verifyToken(forged)).toThrow();
  });
});
