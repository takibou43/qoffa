import jwt, { type SignOptions } from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';
import type { Role } from '../generated/prisma/enums.js';

export interface TokenPayload {
  sub: string;
  role: Role;
}

const MIN_SECRET_LENGTH = 32;

let secret: string | null = env.JWT_SECRET || null;
let loading: Promise<void> | null = null;

/**
 * يحمّل مفتاح التوقيع مرة واحدة لكل عملية.
 * الأولوية لمتغير البيئة JWT_SECRET؛ وإلا يُقرأ من إعداد دور قاعدة البيانات
 * qoffa.jwt_secret (مولَّد داخل PostgreSQL بـ gen_random_bytes ولا يمر عبر أي ملف أو واجهة).
 */
export function ensureJwtSecret(): Promise<void> {
  if (secret) return Promise.resolve();
  loading ??= (async () => {
    const rows = await prisma.$queryRaw<{ s: string | null }[]>`
      SELECT current_setting('qoffa.jwt_secret', true) AS s`;
    const value = rows[0]?.s ?? '';
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error('مفتاح توقيع JWT غير مهيأ: اضبط JWT_SECRET أو qoffa.jwt_secret');
    }
    secret = value;
  })().catch((err: unknown) => {
    loading = null; // يسمح بإعادة المحاولة في الطلب التالي
    throw err;
  });
  return loading;
}

/** Middleware: يضمن جاهزية مفتاح التوقيع قبل مسارات /api */
export const jwtReady: RequestHandler = (_req, _res, next) => {
  ensureJwtSecret().then(() => next(), next);
};

function currentSecret(): string {
  if (!secret) throw new Error('مفتاح توقيع JWT لم يُحمَّل بعد');
  return secret;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, currentSecret(), {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN,
  } as SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, currentSecret(), { algorithms: ['HS256'] });
  if (typeof decoded === 'string') throw new Error('رمز غير صالح');
  return { sub: String(decoded.sub), role: decoded.role as Role };
}
