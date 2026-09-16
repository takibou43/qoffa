import type { Request } from 'express';
import { badRequest } from './errors.js';

/**
 * أنواع Express 5 تسمح لمعاملات المسار أن تكون مصفوفة.
 * هذه الدالة تضمن قيمة نصية واحدة صالحة.
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest(`المعامل "${name}" مفقود أو غير صالح`);
  }
  return value;
}

/** رقم اختياري من query string */
export function numberQuery(req: Request, name: string): number | undefined {
  const raw = req.query[name];
  if (typeof raw !== 'string' || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** عنوان IP للعميل لتسجيله في سجل العمليات الإدارية */
export function clientIp(req: Request): string | undefined {
  return req.ip ?? undefined;
}
