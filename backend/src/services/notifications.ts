import type { NotificationType, OrderStatus } from '../generated/prisma/enums.js';
import { prisma } from '../lib/prisma.js';

type Tx = Pick<typeof prisma, 'notification'>;

interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  orderId?: string;
}

export async function notify(tx: Tx, input: NotifyInput) {
  return tx.notification.create({ data: input });
}

/**
 * ملاحظة: الإنشاء تسلسلي عمدًا — عميل pg لا يدعم استعلامات متوازية
 * على نفس الاتصال داخل معاملة واحدة.
 */
export async function notifyMany(tx: Tx, inputs: NotifyInput[]) {
  for (const input of inputs) {
    await tx.notification.create({ data: input });
  }
}

/** نص الإشعار لكل حالة، لكل جهة */
export const STATUS_NOTIFICATION: Partial<
  Record<OrderStatus, { type: NotificationType; title: string; body: (code: string) => string }>
> = {
  SHOP_ACCEPTED: {
    type: 'ORDER_ACCEPTED',
    title: 'تم قبول طلبك',
    body: (code) => `المحل قبل الطلب ${code} وسيبدأ التحضير قريبًا.`,
  },
  PREPARING: {
    type: 'ORDER_PREPARING',
    title: 'جاري تحضير طلبك',
    body: (code) => `المحل بدأ تحضير الطلب ${code}.`,
  },
  READY_FOR_PICKUP: {
    type: 'ORDER_READY',
    title: 'طلبك جاهز',
    body: (code) => `الطلب ${code} جاهز، جاري البحث عن موصّل.`,
  },
  DRIVER_ASSIGNED: {
    type: 'DRIVER_ASSIGNED',
    title: 'تم تعيين موصّل',
    body: (code) => `موصّل في طريقه لاستلام الطلب ${code}.`,
  },
  PICKED_UP: {
    type: 'ORDER_PICKED_UP',
    title: 'تم استلام الطلب من المحل',
    body: (code) => `الموصّل استلم الطلب ${code}.`,
  },
  OUT_FOR_DELIVERY: {
    type: 'ORDER_OUT_FOR_DELIVERY',
    title: 'الطلب في الطريق إليك',
    body: (code) => `الموصّل في طريقه إليك بالطلب ${code}.`,
  },
  DELIVERED: {
    type: 'ORDER_DELIVERED',
    title: 'تم تسليم الطلب',
    body: (code) => `تم تسليم الطلب ${code}. نتمنى أن تكون الخدمة نالت رضاك.`,
  },
  REJECTED: {
    type: 'ORDER_REJECTED',
    title: 'تم رفض الطلب',
    body: (code) => `للأسف رفض المحل الطلب ${code}.`,
  },
  CANCELLED: {
    type: 'ORDER_CANCELLED',
    title: 'تم إلغاء الطلب',
    body: (code) => `تم إلغاء الطلب ${code}.`,
  },
  NO_DRIVER: {
    type: 'NO_DRIVER_FOUND',
    title: 'لم يُعثر على موصّل',
    body: (code) => `لم نجد موصّلًا متاحًا للطلب ${code} حاليًا. سنعيد المحاولة.`,
  },
  FAILED_DELIVERY: {
    type: 'ORDER_CANCELLED',
    title: 'تعذّر تسليم الطلب',
    body: (code) => `تعذّر تسليم الطلب ${code}. سيتواصل معك فريق المنصة.`,
  },
};
