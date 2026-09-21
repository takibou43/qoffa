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

const MISSING_TABLE = /does not exist|42P01|3F000/;

/** يقرأ المفتاح مع إعادة المحاولة (اتصالات البارد الأولى قد تفشل عابرًا). لا يطبع القيمة أبدًا. */
async function readSecretFromDb(attempts = 3): Promise<string> {
  for (let i = 1; ; i++) {
    try {
      const rows = await prisma.$queryRaw<{ s: string }[]>`
        SELECT value AS s FROM qoffa_private.app_secret WHERE key = 'jwt_secret'`;
      return rows[0]?.s ?? '';
    } catch (err) {
      if (MISSING_TABLE.test(String(err))) return '';
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 150 * i));
    }
  }
}

/**
 * يحمّل مفتاح التوقيع مرة واحدة لكل عملية.
 * الأولوية لمتغير البيئة JWT_SECRET؛ وإلا يُقرأ من الجدول الخاص qoffa_private.app_secret
 * (قيمة مولَّدة داخل PostgreSQL بـ gen_random_bytes، لا تمر عبر أي ملف أو طرفية أو واجهة،
 * والمخطط غير مكشوف لواجهات Supabase العامة، وصلاحية الخادم عليه قراءة فقط).
 */
export function ensureJwtSecret(): Promise<void> {
  if (secret) return Promise.resolve();
  loading ??= (async () => {
    const value = await readSecretFromDb();
    if (value.length < MIN_SECRET_LENGTH) {
      throw new Error('مفتاح توقيع JWT غير مهيأ: اضبط JWT_SECRET أو qoffa_private.app_secret');
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
