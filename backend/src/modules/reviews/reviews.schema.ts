import { z } from 'zod';

export const createReviewSchema = z.object({
  /** تقييم المحل (اختياري إن قُيّم مسبقًا) */
  shop: z
    .object({
      rating: z.number().int().min(1, 'التقييم من 1 إلى 5').max(5),
      comment: z.string().trim().max(400).nullable().optional(),
    })
    .optional(),
  /** تقييم الموصّل */
  driver: z
    .object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().max(400).nullable().optional(),
    })
    .optional(),
}).refine((v) => v.shop || v.driver, {
  message: 'يجب تقييم المحل أو الموصّل على الأقل',
});
