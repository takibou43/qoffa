import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const disabled = env.isTest;

/** حد عام لكل الطلبات */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'عدد كبير من الطلبات، حاول بعد قليل' },
  },
});

/** حد صارم لمسارات المصادقة لمنع محاولات تخمين كلمات المرور */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: () => disabled,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'محاولات كثيرة. حاول مرة أخرى بعد 15 دقيقة.',
    },
  },
});

/** حد لعمليات الكتابة الحساسة */
export const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: {
    error: { code: 'TOO_MANY_REQUESTS', message: 'عدد كبير من العمليات، حاول بعد قليل' },
  },
});
