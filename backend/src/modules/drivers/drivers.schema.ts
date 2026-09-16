import { z } from 'zod';

export const availabilitySchema = z.object({
  isAvailable: z.boolean(),
  // الموقع اختياري لكنه يحسّن ترتيب العروض
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const failDeliverySchema = z.object({
  reason: z.string().trim().min(2, 'يرجى ذكر سبب تعذّر التسليم').max(200),
});
