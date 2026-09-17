import type { OrderStatus } from './types';

/** كل المبالغ أعداد صحيحة بالدينار الجزائري */
export const formatDzd = (amount: number) => `${amount.toLocaleString('ar-DZ')} دج`;

export function formatDistance(meters: number | null): string | null {
  if (meters === null || meters === undefined) return null;
  if (meters < 1000) return `${meters} م`;
  return `${(meters / 1000).toFixed(1)} كم`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ar-DZ', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return formatDateTime(iso);
}

/** تسميات الحالات — مطابقة تمامًا لحالات الـBackend، بلا منطق انتقال في الواجهة */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'في انتظار موافقة المحل',
  SHOP_ACCEPTED: 'قبِل المحل الطلب',
  PREPARING: 'جاري التحضير',
  READY_FOR_PICKUP: 'جاهز — البحث عن موصّل',
  DRIVER_ASSIGNED: 'تم تعيين موصّل',
  PICKED_UP: 'الموصّل استلم الطلب',
  OUT_FOR_DELIVERY: 'في الطريق إليك',
  DELIVERED: 'تم التسليم',
  REJECTED: 'رفضه المحل',
  CANCELLED: 'ملغى',
  NO_DRIVER: 'لا يوجد موصّل متاح',
  FAILED_DELIVERY: 'تعذّر التسليم',
};

export const STATUS_TONE: Record<OrderStatus, 'pending' | 'active' | 'done' | 'failed'> = {
  PENDING: 'pending',
  SHOP_ACCEPTED: 'active',
  PREPARING: 'active',
  READY_FOR_PICKUP: 'active',
  DRIVER_ASSIGNED: 'active',
  PICKED_UP: 'active',
  OUT_FOR_DELIVERY: 'active',
  DELIVERED: 'done',
  REJECTED: 'failed',
  CANCELLED: 'failed',
  NO_DRIVER: 'pending',
  FAILED_DELIVERY: 'failed',
};

/** ترتيب المسار الطبيعي لعرض الخط الزمني */
export const HAPPY_PATH: OrderStatus[] = [
  'PENDING',
  'SHOP_ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DRIVER_ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

export const isActiveOrder = (status: OrderStatus) =>
  !['DELIVERED', 'REJECTED', 'CANCELLED', 'FAILED_DELIVERY'].includes(status);

/** رابط ملاحة يفتح تطبيق الخرائط المثبّت على الهاتف */
export const mapsUrl = (lat: number, lon: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

export const telUrl = (phone: string) => `tel:${phone}`;
