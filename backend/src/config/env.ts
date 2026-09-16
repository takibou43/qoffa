import 'dotenv/config';
import { z } from 'zod';

const intFromEnv = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intFromEnv(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL مطلوب'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET يجب أن يكون 16 حرفًا على الأقل'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGINS: z.string().default(''),

  PLATFORM_COMMISSION_BPS: intFromEnv(1000),
  DEFAULT_DELIVERY_FEE: intFromEnv(150),
  DRIVER_FEE_SHARE_BPS: intFromEnv(8000),
  SEARCH_RADIUS_KM: intFromEnv(10),
  DRIVER_OFFER_TIMEOUT_SECONDS: intFromEnv(45),
  MAX_DRIVER_OFFERS: intFromEnv(6),

  PLATFORM_OWNER_EMAIL: z.string().email().optional().or(z.literal('')),
  PLATFORM_OWNER_PHONE: z.string().optional(),
  PLATFORM_OWNER_NAME: z.string().optional(),
  PLATFORM_OWNER_PASSWORD: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('✖ متغيرات البيئة غير صالحة:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  /** بريد مالك المنصة — لا يُعرض إلا لمدراء المنصة */
  platformOwnerEmail: raw.PLATFORM_OWNER_EMAIL || null,
};

export type Env = typeof env;
