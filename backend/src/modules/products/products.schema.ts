import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';

/**
 * توحيد صيغة الباركود قبل أي بحث أو حفظ:
 *  - إزالة المسافات.
 *  - إن كان رقميًا فقط (مع مسافات/شرطات كما يكتبه البشر) تُزال الشرطات أيضًا.
 *  - لا يُغيَّر أي رقم ولا حالة الأحرف (Code128 حساس لها).
 */
export function normalizeBarcode(raw: string): string {
  const compact = raw.trim().replace(/\s+/g, '');
  return /^[0-9-]+$/.test(compact) ? compact.replace(/-/g, '') : compact;
}

export const BARCODE_REGEX = /^[A-Za-z0-9._-]{4,40}$/;
const BARCODE_MESSAGE = 'كود البار من 4 إلى 40 خانة: أرقام وأحرف لاتينية (و . _ -) فقط';

/** النص الفارغ أو null يعني «بدون باركود» */
export const barcodeSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : normalizeBarcode(v)) : v),
  z.string().regex(BARCODE_REGEX, BARCODE_MESSAGE).nullable(),
);

/** بيانات المنتج العالمي (تُقبل فقط عند إنشاء منتج جديد لباركود جديد) */
const globalFields = {
  name: z.string().trim().min(2, 'اسم المنتج قصير جدًا').max(100).optional(),
  brand: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(400).nullable().optional(),
  imageUrl: z.string().trim().url('رابط الصورة غير صالح').max(500).nullable().optional(),
  unit: z.string().trim().min(1).max(30).optional(),
  categoryId: z.string().nullable().optional(),
};

/** بيانات خاصة بالمحل وحده */
const shopFields = {
  price: z.number().int('السعر بالدينار كعدد صحيح').min(1).max(1_000_000),
  stock: z.number().int('الكمية عدد صحيح').min(0).max(1_000_000).nullable().optional(),
  isAvailable: z.boolean().default(true),
  isHidden: z.boolean().default(false),
};

export const addProductSchema = z.object({
  barcode: barcodeSchema.optional(),
  ...globalFields,
  ...shopFields,
});
export type AddProductInput = z.infer<typeof addProductSchema>;

/** تعديل عرض المحل: حقول المحل + (لمنتج خاص بلا باركود فقط) الحقول العالمية */
export const updateListingSchema = z.object({
  barcode: barcodeSchema.optional(),
  ...globalFields,
  price: shopFields.price.optional(),
  stock: shopFields.stock,
  isAvailable: z.boolean().optional(),
  isHidden: z.boolean().optional(),
});
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

/** تعديل المنتج العالمي (مدير المنصة) */
export const adminUpdateProductSchema = z
  .object({
    barcode: barcodeSchema.optional(),
    name: z.string().trim().min(2).max(100).optional(),
    brand: z.string().trim().max(60).nullable().optional(),
    description: z.string().trim().max(400).nullable().optional(),
    imageUrl: z.string().trim().url().max(500).nullable().optional(),
    unit: z.string().trim().min(1).max(30).optional(),
    categoryId: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'لا توجد حقول للتعديل' });

export const myProductsQuery = paginationSchema.extend({
  q: z.string().trim().max(60).optional(),
  categoryId: z.string().optional(),
  availability: z.enum(['all', 'available', 'unavailable', 'hidden']).default('all'),
});
export type MyProductsQuery = z.infer<typeof myProductsQuery>;

export const barcodeParam = z.object({
  code: z
    .string()
    .transform(normalizeBarcode)
    .pipe(z.string().regex(BARCODE_REGEX, BARCODE_MESSAGE)),
});

/** توافق مع الأسماء القديمة */
export const createProductSchema = addProductSchema;
export const updateProductSchema = updateListingSchema;
