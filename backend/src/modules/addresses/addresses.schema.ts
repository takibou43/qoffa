import { z } from 'zod';

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(30).default('المنزل'),
  addressLine: z.string().trim().min(5, 'العنوان قصير جدًا').max(200),
  city: z.string().trim().min(2).max(60),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  notes: z.string().trim().max(200).nullable().optional(),
  setDefault: z.boolean().default(false),
});

export const updateAddressSchema = addressSchema.partial();
