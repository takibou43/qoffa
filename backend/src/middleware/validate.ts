import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { badRequest } from '../lib/errors.js';

type Source = 'body' | 'query' | 'params';

function formatZodError(err: ZodError) {
  return err.issues.map((i) => ({
    field: i.path.join('.') || '(root)',
    message: i.message,
  }));
}

/**
 * يتحقق من صحة المدخلات ويستبدلها بالنسخة المُحوّلة.
 * ملاحظة: في Express 5 لا يمكن استبدال req.query كاملًا، لذا نخزّن النتيجة في res.locals.
 */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(badRequest('بيانات غير صالحة', formatZodError(result.error)));
    }
    if (source === 'body') {
      req.body = result.data;
    } else {
      res.locals[source] = result.data;
    }
    next();
  };
}

/** يقرأ نتيجة التحقق من query/params */
export function validated<T>(res: Response, source: Exclude<Source, 'body'>): T {
  return res.locals[source] as T;
}
