/**
 * قُفّة — آلة حالات الطلب.
 *
 * هذا الملف هو المصدر الوحيد للحقيقة بخصوص الانتقالات المسموح بها.
 * أي تغيير لحالة طلب في المشروع يجب أن يمر من هنا — لا تحديث مباشر لـ order.status.
 */
import type { ActorType, OrderStatus } from '../generated/prisma/enums.js';
import { conflict, forbidden } from '../lib/errors.js';

/** الحالات النهائية التي لا يخرج منها الطلب */
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
] as const;

/**
 * جدول الانتقالات: من الحالة → إلى الحالة → الجهات المخوّلة.
 * أي انتقال غير مذكور هنا ممنوع.
 */
export const TRANSITIONS: Record<
  OrderStatus,
  Partial<Record<OrderStatus, readonly ActorType[]>>
> = {
  PENDING: {
    SHOP_ACCEPTED: ['SHOP', 'ADMIN'],
    REJECTED: ['SHOP', 'ADMIN'],
    CANCELLED: ['CUSTOMER', 'ADMIN'],
  },
  SHOP_ACCEPTED: {
    PREPARING: ['SHOP', 'ADMIN'],
    // المحل يستطيع الرفض ما دام لم يبدأ التحضير
    REJECTED: ['SHOP', 'ADMIN'],
    CANCELLED: ['CUSTOMER', 'ADMIN'],
  },
  PREPARING: {
    READY_FOR_PICKUP: ['SHOP', 'ADMIN'],
    // بعد بدء التحضير لم يعد الزبون يستطيع الإلغاء
    CANCELLED: ['ADMIN'],
  },
  READY_FOR_PICKUP: {
    DRIVER_ASSIGNED: ['DRIVER', 'SYSTEM', 'ADMIN'],
    NO_DRIVER: ['SYSTEM', 'ADMIN'],
    CANCELLED: ['ADMIN'],
  },
  DRIVER_ASSIGNED: {
    PICKED_UP: ['DRIVER', 'ADMIN'],
    // الموصّل تراجع أو انتهت مهلته → يعود الطلب للبحث عن موصّل
    READY_FOR_PICKUP: ['DRIVER', 'SYSTEM', 'ADMIN'],
    CANCELLED: ['ADMIN'],
  },
  PICKED_UP: {
    OUT_FOR_DELIVERY: ['DRIVER', 'ADMIN'],
    FAILED_DELIVERY: ['DRIVER', 'ADMIN'],
    CANCELLED: ['ADMIN'],
  },
  OUT_FOR_DELIVERY: {
    DELIVERED: ['DRIVER', 'ADMIN'],
    FAILED_DELIVERY: ['DRIVER', 'ADMIN'],
  },
  NO_DRIVER: {
    // إعادة محاولة المطابقة — لا يُلغى الطلب تلقائيًا
    READY_FOR_PICKUP: ['SHOP', 'SYSTEM', 'ADMIN'],
    CANCELLED: ['SHOP', 'ADMIN'],
  },
  FAILED_DELIVERY: {
    OUT_FOR_DELIVERY: ['ADMIN'],
    CANCELLED: ['ADMIN'],
  },
  DELIVERED: {},
  REJECTED: {},
  CANCELLED: {},
};

/** الطوابع الزمنية المرتبطة بكل حالة */
export const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  SHOP_ACCEPTED: 'acceptedAt',
  PREPARING: 'preparingAt',
  READY_FOR_PICKUP: 'readyAt',
  DRIVER_ASSIGNED: 'assignedAt',
  PICKED_UP: 'pickedUpAt',
  OUT_FOR_DELIVERY: 'outForDeliveryAt',
  DELIVERED: 'deliveredAt',
};

export const isTerminal = (status: OrderStatus): boolean =>
  TERMINAL_STATUSES.includes(status);

/** الحالات التي يمكن الانتقال إليها من حالة معيّنة (بغض النظر عن الجهة) */
export const allowedNextStatuses = (from: OrderStatus): OrderStatus[] =>
  Object.keys(TRANSITIONS[from]) as OrderStatus[];

export const canTransition = (
  from: OrderStatus,
  to: OrderStatus,
  actor: ActorType,
): boolean => (TRANSITIONS[from][to] ?? []).includes(actor);

/**
 * يرمي خطأ مفهومًا إن كان الانتقال ممنوعًا.
 * - 409 إن كان الانتقال غير منطقي أصلًا (الحالة لا تسمح).
 * - 403 إن كان الانتقال ممكنًا لكن ليس لهذه الجهة.
 */
export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: ActorType,
): void {
  if (from === to) {
    throw conflict(`الطلب في حالة ${to} أصلًا`);
  }
  if (isTerminal(from)) {
    throw conflict('الطلب في حالة نهائية ولا يمكن تغييره');
  }

  const actors = TRANSITIONS[from][to];
  if (!actors) {
    throw conflict(`لا يمكن الانتقال من ${from} إلى ${to}`, {
      from,
      to,
      allowed: allowedNextStatuses(from),
    });
  }
  if (!actors.includes(actor)) {
    throw forbidden(`ليست لديك صلاحية تنفيذ هذا الانتقال (${from} → ${to})`);
  }
}
