import { z } from 'zod';
import { paginationSchema } from '../../lib/pagination.js';

export const ORDER_STATUSES = [
  'PENDING',
  'SHOP_ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DRIVER_ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
  'NO_DRIVER',
  'FAILED_DELIVERY',
] as const;

const manualAddress = z.object({
  addressLine: z.string().trim().min(5).max(200),
  city: z.string().trim().min(2).max(60),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const createOrderSchema = z
  .object({
    shopId: z.string().min(1),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.number().int().min(1).max(99),
        }),
      )
      .min(1, 'السلة فارغة')
      .max(50),
    // إما عنوان محفوظ أو عنوان يدوي (لمن رفض مشاركة الموقع أو لم يحفظ عنوانًا)
    addressId: z.string().min(1).optional(),
    address: manualAddress.optional(),
    customerNote: z.string().trim().max(300).nullable().optional(),
    paymentMethod: z.literal('CASH_ON_DELIVERY').default('CASH_ON_DELIVERY'),
    /** مفتاح منع التكرار (يولّده الواجهة مرة لكل عملية دفع) — إعادة الإرسال لا تنشئ طلبًا ثانيًا */
    clientRequestId: z
      .string()
      .trim()
      .min(8)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/)
      .optional(),
  })
  .refine((v) => Boolean(v.addressId) || Boolean(v.address), {
    message: 'يجب اختيار عنوان تسليم أو إدخاله يدويًا',
    path: ['addressId'],
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const quoteQuery = z.object({
  shopId: z.string().min(1),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});
export type QuoteQuery = z.infer<typeof quoteQuery>;

export const listOrdersQuery = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  /** مجموعات جاهزة للوحة المحل */
  bucket: z.enum(['new', 'active', 'ready', 'completed', 'cancelled']).optional(),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuery>;

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const rejectOrderSchema = z.object({
  reason: z.string().trim().min(2, 'يرجى ذكر سبب الرفض').max(200),
});

export const failDeliverySchema = z.object({
  reason: z.string().trim().min(2, 'يرجى ذكر سبب تعذّر التسليم').max(200),
});

export const adminForceStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(200).optional(),
});

/** محتوى QR كما قرأته الكاميرا — يُتحقق من صيغته وملكيته في الخادم */
export const verifyQrSchema = z.object({
  payload: z.string().trim().min(1, 'رمز QR فارغ').max(300),
});

/** استلام الطلب من المحل: حمولة QR الطلبية كما قرأتها الكاميرا */
export const pickupSchema = z.object({
  payload: z.string({ required_error: 'امسح رمز QR الطلبية في المحل' }).trim().min(1, 'رمز QR فارغ').max(300),
});

/** تأكيد التسليم: QR الزبون أو رمز PIN من 4 أرقام */
export const deliverSchema = z
  .object({
    payload: z.string().trim().min(1).max(300).optional(),
    pin: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'رمز التسليم 4 أرقام')
      .optional(),
  })
  .refine((v) => Boolean(v.payload) || Boolean(v.pin), {
    message: 'امسح رمز QR الزبون أو أدخل رمز التسليم',
    path: ['pin'],
  });
