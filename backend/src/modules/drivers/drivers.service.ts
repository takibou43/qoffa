import { forbidden, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';

export const driverProfileSelect = {
  id: true,
  status: true,
  isAvailable: true,
  vehicleType: true,
  plateNumber: true,
  latitude: true,
  longitude: true,
  lastLocationAt: true,
  currentOrderId: true,
  ratingAvg: true,
  ratingCount: true,
} as const;

/** ملف الموصّل المرتبط بالحساب — أساس كل عمليات تطبيق الموصّل */
export async function getDriverProfileOrThrow(userId: string) {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    select: driverProfileSelect,
  });
  if (!profile) throw notFound('لا يوجد ملف موصّل مرتبط بهذا الحساب');
  return profile;
}

export function assertDriverApproved(status: string) {
  if (status !== 'APPROVED') {
    throw forbidden(
      status === 'PENDING'
        ? 'حسابك قيد المراجعة من إدارة المنصة'
        : 'حسابك غير مفعّل حاليًا. تواصل مع إدارة المنصة.',
    );
  }
}

export async function setAvailability(
  userId: string,
  input: { isAvailable: boolean; latitude?: number; longitude?: number },
) {
  const profile = await getDriverProfileOrThrow(userId);
  assertDriverApproved(profile.status);

  return prisma.driverProfile.update({
    where: { id: profile.id },
    data: {
      isAvailable: input.isAvailable,
      ...(input.latitude !== undefined && input.longitude !== undefined
        ? {
            latitude: input.latitude,
            longitude: input.longitude,
            lastLocationAt: new Date(),
          }
        : {}),
    },
    select: driverProfileSelect,
  });
}

/**
 * تحديث الموقع — يُستدعى فقط عندما يكون الموصّل متاحًا أو يحمل طلبًا.
 * لا نحتفظ بسجل تاريخي للمواقع في MVP احترامًا للخصوصية.
 */
export async function updateLocation(
  userId: string,
  input: { latitude: number; longitude: number },
) {
  const profile = await getDriverProfileOrThrow(userId);
  assertDriverApproved(profile.status);

  if (!profile.isAvailable && !profile.currentOrderId) {
    throw forbidden('لا يُحدَّث الموقع إلا عندما تكون متاحًا أو لديك طلب جارٍ');
  }

  return prisma.driverProfile.update({
    where: { id: profile.id },
    data: {
      latitude: input.latitude,
      longitude: input.longitude,
      lastLocationAt: new Date(),
    },
    select: { id: true, latitude: true, longitude: true, lastLocationAt: true },
  });
}

/** العروض المعلّقة والسارية لهذا الموصّل */
export async function listPendingOffers(driverProfileId: string) {
  return prisma.deliveryOffer.findMany({
    where: { driverId: driverProfileId, status: 'PENDING', expiresAt: { gt: new Date() } },
    select: {
      id: true,
      expiresAt: true,
      distanceMeters: true,
      createdAt: true,
      order: {
        select: {
          id: true,
          code: true,
          total: true,
          deliveryFee: true,
          deliveryAddressLine: true,
          deliveryCity: true,
          distanceMeters: true,
          shop: {
            select: {
              id: true,
              name: true,
              addressLine: true,
              latitude: true,
              longitude: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/** الطلب الجاري للموصّل بكل ما يحتاجه لإتمام التوصيل */
export async function getCurrentDelivery(driverProfileId: string) {
  const order = await prisma.order.findFirst({
    where: {
      driverId: driverProfileId,
      status: { in: ['DRIVER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'] },
    },
    select: {
      id: true,
      code: true,
      status: true,
      total: true,
      deliveryFee: true,
      subtotal: true,
      paymentMethod: true,
      customerNote: true,
      customerPhone: true,
      deliveryAddressLine: true,
      deliveryCity: true,
      deliveryLatitude: true,
      deliveryLongitude: true,
      distanceMeters: true,
      assignedAt: true,
      pickedUpAt: true,
      outForDeliveryAt: true,
      items: { select: { nameSnapshot: true, quantity: true, unitSnapshot: true } },
      customer: { select: { fullName: true, phone: true } },
      shop: {
        select: {
          id: true,
          name: true,
          phone: true,
          addressLine: true,
          city: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });
  return order;
}

/** يتأكد أن الطلب مُسند فعلًا لهذا الموصّل */
export async function assertDriverOrder(orderId: string, driverProfileId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, driverId: driverProfileId },
    select: { id: true, status: true },
  });
  if (!order) throw notFound('هذا الطلب غير مُسند إليك');
  return order;
}

export async function getDriverStats(driverProfileId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfWeek.getDate() - 6);

  const [today, week, completedToday, completedWeek, wallet] = await Promise.all([
    prisma.delivery.aggregate({
      where: { driverId: driverProfileId, deliveredAt: { gte: startOfDay } },
      _sum: { earning: true },
    }),
    prisma.delivery.aggregate({
      where: { driverId: driverProfileId, deliveredAt: { gte: startOfWeek } },
      _sum: { earning: true },
    }),
    prisma.delivery.count({
      where: { driverId: driverProfileId, deliveredAt: { gte: startOfDay } },
    }),
    prisma.delivery.count({
      where: { driverId: driverProfileId, deliveredAt: { gte: startOfWeek } },
    }),
    prisma.wallet.findUnique({ where: { driverId: driverProfileId }, select: { balance: true } }),
  ]);

  return {
    todayEarnings: today._sum.earning ?? 0,
    weekEarnings: week._sum.earning ?? 0,
    todayDeliveries: completedToday,
    weekDeliveries: completedWeek,
    walletBalance: wallet?.balance ?? 0,
  };
}
