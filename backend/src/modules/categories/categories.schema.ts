import { z } from 'zod';

export const listCategoriesQuery = z.object({
  kind: z.enum(['SHOP', 'PRODUCT']).optional(),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'الرمز يجب أن يحتوي حروفًا لاتينية صغيرة وأرقامًا وشرطات فقط'),
  kind: z.enum(['SHOP', 'PRODUCT']).default('PRODUCT'),
  iconKey: z.string().trim().max(40).optional(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const updateCategorySchema = createCategorySchema.partial();
