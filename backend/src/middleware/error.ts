import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'المسار غير موجود' },
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // أخطاء Prisma المعروفة + أخطاء body-parser
  const anyErr = err as { code?: string; meta?: Record<string, unknown>; type?: string; status?: number };
  if (anyErr?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'صيغة JSON غير صالحة' },
    });
  }
  if (anyErr?.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'حجم الطلب أكبر من المسموح' },
    });
  }
  if (anyErr?.code === 'P2002') {
    const target = (anyErr.meta?.target as string[] | undefined)?.join(', ');
    return res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: target ? `القيمة مستعملة مسبقًا (${target})` : 'القيمة مستعملة مسبقًا',
      },
    });
  }
  if (anyErr?.code === 'P2025') {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'العنصر غير موجود' },
    });
  }

  console.error('[unhandled]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'حدث خطأ غير متوقع',
      ...(env.isProduction ? {} : { debug: String(err) }),
    },
  });
}
