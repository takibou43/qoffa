import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';
import { phoneSchema } from '../auth/auth.schema.js';

export const nearbyShopsQuery = paginationSchema.extend({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(50).optional(),
  q: z.string().trim().max(60).optional(),
  categoryId: z.string().optional(),
  openOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type NearbyShopsQuery = z.infer<typeof nearbyShopsQuery>;

export const shopProductsQuery = paginationSchema.extend({
  q: z.string().trim().max(60).optional(),
  categoryId: z.string().optional(),
});
export type ShopProductsQuery = z.infer<typeof shopProductsQuery>;

export const updateMyShopSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  imageUrl: z.string().trim().url('رابط الصورة غير صالح').max(500).nullable().optional(),
  phone: phoneSchema.optional(),
  addressLine: z.string().trim().min(5).max(200).optional(),
  city: z.string().trim().min(2).max(60).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  openingTime: z.string().regex(/^\d{2}:\d{2}$/, 'الوقت بصيغة HH:MM').optional(),
  closingTime: z.string().regex(/^\d{2}:\d{2}$/, 'الوقت بصيغة HH:MM').optional(),
  deliveryFee: z.number().int().min(0).max(5000).optional(),
  categoryId: z.string().nullable().optional(),
});

export const toggleOpenSchema = z.object({
  isOpen: z.boolean(),
});
