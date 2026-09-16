import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';
import { verifyToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import type { Role } from '../generated/prisma/enums.js';

/** الأدوار التي تملك صلاحيات إدارية */
export const ADMIN_ROLES: Role[] = ['ADMIN', 'SUPER_ADMIN'];

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * يتحقق من الرمز ومن أن الحساب ما زال فعّالًا.
 * نقرأ حالة المستخدم من قاعدة البيانات في كل طلب حتى يسري التعطيل فورًا.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next(unauthorized());

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(unauthorized('رمز الدخول غير صالح أو منتهي الصلاحية'));
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, status: true },
  });

  if (!user) return next(unauthorized('الحساب غير موجود'));
  if (user.status === 'SUSPENDED') {
    return next(forbidden('تم تعليق هذا الحساب. تواصل مع إدارة المنصة.'));
  }

  // الدور يُقرأ من قاعدة البيانات لا من الرمز، حتى لا يبقى رمز قديم يحمل دورًا أُلغي
  req.auth = { userId: user.id, role: user.role };
  next();
}

/** يسمح فقط للأدوار المذكورة */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden());
    next();
  };
}

export const requireAdmin = requireRole('ADMIN', 'SUPER_ADMIN');
export const requireSuperAdmin = requireRole('SUPER_ADMIN');

/** مصادقة اختيارية — تُستعمل في المسارات العامة التي تتغيّر نتيجتها إن كان المستخدم مسجّلًا */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true },
    });
    if (user && user.status === 'ACTIVE') {
      req.auth = { userId: user.id, role: user.role };
    }
  } catch {
    // نتجاهل الرمز غير الصالح في المسارات العامة
  }
  next();
}
