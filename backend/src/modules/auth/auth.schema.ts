import { z } from 'zod';

/** أرقام الهواتف الجزائرية: 0X XX XX XX XX */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^0[5-7]\d{8}$/, 'رقم الهاتف غير صالح (مثال: 0551234567)');

export const passwordSchema = z
  .string()
  .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
  .max(128);

const baseRegister = {
  fullName: z.string().trim().min(3, 'الاسم قصير جدًا').max(80),
  phone: phoneSchema,
  email: z.string().trim().email('البريد غير صالح').optional().or(z.literal('')),
  password: passwordSchema,
};

export const registerCustomerSchema = z.object({
  ...baseRegister,
});

export const registerShopSchema = z.object({
  ...baseRegister,
  shop: z.object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).optional(),
    phone: phoneSchema,
    addressLine: z.string().trim().min(5).max(200),
    city: z.string().trim().min(2).max(60),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    categoryId: z.string().cuid().optional(),
  }),
});

export const registerDriverSchema = z.object({
  ...baseRegister,
  driver: z.object({
    vehicleType: z.string().trim().min(2).max(40).default('دراجة نارية'),
    plateNumber: z.string().trim().max(20).optional(),
  }),
});

/** الدخول برقم الهاتف أو بالبريد الإلكتروني (أحدهما بالضبط) */
export const loginSchema = z
  .object({
    phone: phoneSchema.optional(),
    email: z.string().trim().toLowerCase().email('البريد غير صالح').optional(),
    password: z.string().min(1, 'كلمة المرور مطلوبة'),
  })
  .refine((v) => Boolean(v.phone) !== Boolean(v.email), {
    message: 'أدخل رقم الهاتف أو البريد الإلكتروني',
    path: ['phone'],
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(3).max(80).optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
});

export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;
export type RegisterShopInput = z.infer<typeof registerShopSchema>;
export type RegisterDriverInput = z.infer<typeof registerDriverSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
