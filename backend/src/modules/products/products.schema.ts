import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'اسم المنتج قصير جدًا').max(100),
  description: z.string().trim().max(400).nullable().optional(),
  imageUrl: z.string().trim().url('رابط الصورة غير صالح').max(500).nullable().optional(),
  price: z.number().int('السعر بالدينار كعدد صحيح').min(1).max(1_000_000),
  unit: z.string().trim().min(1).max(20).default('قطعة'),
  categoryId: z.string().nullable().optional(),
  isAvailable: z.boolean().default(true),
  isHidden: z.boolean().default(false),
});

export const updateProductSchema = createProductSchema.partial();

export const myProductsQuery = paginationSchema.extend({
  q: z.string().trim().max(60).optional(),
  categoryId: z.string().optional(),
  availability: z.enum(['all', 'available', 'unavailable', 'hidden']).default('all'),
});
export type MyProductsQuery = z.infer<typeof myProductsQuery>;
