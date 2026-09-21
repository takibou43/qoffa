import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';
import { ORDER_STATUSES } from '../orders/orders.schema.js';

export const listUsersQuery = paginationSchema.extend({
  role: z.enum(['CUSTOMER', 'SHOP_OWNER', 'DRIVER', 'ADMIN', 'SUPER_ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  q: z.string().trim().max(60).optional(),
});

export const listShopsQuery = paginationSchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  q: z.string().trim().max(60).optional(),
});

export const listDriversQuery = paginationSchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(),
  q: z.string().trim().max(60).optional(),
});

export const listOrdersAdminQuery = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  shopId: z.string().optional(),
  q: z.string().trim().max(60).optional(),
});

export const listAuditQuery = paginationSchema.extend({
  actorId: z.string().optional(),
  targetType: z.string().max(30).optional(),
});

export const reasonSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const setUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().max(200).optional(),
});

export const approvalSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
  reason: z.string().trim().max(200).optional(),
});

export const commissionSchema = z.object({
  /** نقاط أساسية: 1000 = 10% */
  commissionBps: z.number().int().min(0).max(5000),
});

export const createAdminSchema = z.object({
  fullName: z.string().trim().min(3).max(80),
  phone: z.string().trim().regex(/^0[5-7]\d{8}$/, 'رقم الهاتف غير صالح'),
  email: z.string().trim().email(),
  password: z.string().min(10, 'كلمة مرور المدير 10 أحرف على الأقل').max(128),
});

export const walletAdjustSchema = z.object({
  /** موجب أو سالب بالدينار */
  amount: z.number().int().refine((v) => v !== 0, 'المبلغ لا يمكن أن يكون صفرًا'),
  description: z.string().trim().min(3, 'يجب توضيح سبب التعديل').max(200),
});

/** معاملات تسعير التوصيل بالمسافة — تضبطها الإدارة فقط */
export const deliveryPricingSchema = z.object({
  baseFee: z.number().int().min(0).max(20_000),
  baseKm: z.number().min(0).max(50),
  perKmFee: z.number().int().min(0).max(5_000),
  maxKm: z.number().min(1).max(100),
  roadFactor: z.number().min(1).max(2),
});

export const settingSchema = z.object({
  value: z.union([z.number(), z.string(), z.boolean()]),
  label: z.string().trim().max(120).optional(),
  group: z.string().trim().max(40).optional(),
});
