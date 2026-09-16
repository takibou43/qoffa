import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { paginated, type Pagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import type { Role } from '../../generated/prisma/enums.js';
import { audit } from '../../services/audit.js';

/* ───────────────────────── حماية دور المالك ───────────────────────── */

/**
 * قواعد غير قابلة للتجاوز، مُطبَّقة في الخادم:
 *  - لا يُنشأ SUPER_ADMIN من أي API (فقط seed بمتغيرات البيئة).
 *  - لا يُعدَّل ولا يُعلَّق حساب SUPER_ADMIN من أي مدير.
 *  - المدير العادي (ADMIN) لا يُنشئ ولا يحذف مدراء.
 */
export function assertCanTouchUser(actorRole: Role, targetRole: Role) {
  if (targetRole === 'SUPER_ADMIN') {
    throw forbidden('لا يمكن تعديل حساب مالك المنصة');
  }
  if (targetRole === 'ADMIN' && actorRole !== 'SUPER_ADMIN') {
    throw forbidden('إدارة حسابات المدراء متاحة لمالك المنصة فقط');
  }
}

/* ───────────────────────── المستخدمون ───────────────────────── */

const adminUserSelect = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

export async function listUsers(
  query: Pagination & { role?: Role; status?: 'ACTIVE' | 'SUSPENDED'; q?: string },
) {
  const where = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { fullName: { contains: query.q, mode: 'insensitive' as const } },
            { phone: { contains: query.q } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: adminUserSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.user.count({ where }),
  ]);
  return paginated(items, total, query);
}

export async function setUserStatus(
  actor: { id: string; role: Role },
  userId: string,
  status: 'ACTIVE' | 'SUSPENDED',
  reason: string | undefined,
  ip?: string,
) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true },
  });
  if (!target) throw notFound('المستخدم غير موجود');
  if (target.id === actor.id) throw badRequest('لا يمكنك تعديل حالة حسابك');
  assertCanTouchUser(actor.role, target.role);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status },
    select: adminUserSelect,
  });

  // تعليق صاحب محل أو موصّل يوقف نشاطه فورًا
  if (status === 'SUSPENDED') {
    await prisma.shop.updateMany({ where: { ownerId: userId }, data: { isOpen: false } });
    await prisma.driverProfile.updateMany({
      where: { userId },
      data: { isAvailable: false },
    });
  }

  await audit(
    {
      actorId: actor.id,
      action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      targetType: 'user',
      targetId: userId,
      metadata: { from: target.status, to: status, reason },
      ipAddress: ip,
    },
  );

  return updated;
}

/** إنشاء مدير — لمالك المنصة فقط */
export async function createAdmin(
  actor: { id: string; role: Role },
  input: { fullName: string; phone: string; email: string; password: string },
  ip?: string,
) {
  if (actor.role !== 'SUPER_ADMIN') {
    throw forbidden('إنشاء المدراء متاح لمالك المنصة فقط');
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone: input.phone }, { email: input.email }] },
    select: { id: true },
  });
  if (existing) throw conflict('رقم الهاتف أو البريد مستعمل مسبقًا');

  const created = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone: input.phone,
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      // الدور ثابت هنا: لا يمكن إنشاء SUPER_ADMIN من أي API
      role: 'ADMIN',
      mustChangePassword: true,
    },
    select: adminUserSelect,
  });

  await audit({
    actorId: actor.id,
    action: 'ADMIN_CREATED',
    targetType: 'user',
    targetId: created.id,
    metadata: { email: created.email },
    ipAddress: ip,
  });

  return created;
}

/** إزالة مدير (تحويله إلى حساب معلّق) — لمالك المنصة فقط */
export async function removeAdmin(
  actor: { id: string; role: Role },
  userId: string,
  ip?: string,
) {
  if (actor.role !== 'SUPER_ADMIN') {
    throw forbidden('إزالة المدراء متاحة لمالك المنصة فقط');
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });
  if (!target) throw notFound('المستخدم غير موجود');
  if (target.role === 'SUPER_ADMIN') throw forbidden('لا يمكن إزالة مالك المنصة');
  if (target.role !== 'ADMIN') throw badRequest('هذا الحساب ليس حساب مدير');

  await prisma.user.update({ where: { id: userId }, data: { status: 'SUSPENDED' } });
  await audit({
    actorId: actor.id,
    action: 'ADMIN_REMOVED',
    targetType: 'user',
    targetId: userId,
    ipAddress: ip,
  });
}

/* ───────────────────────── المحلات ───────────────────────── */

export async function listShops(query: Pagination & { status?: string; q?: string }) {
  const where = {
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.shop.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        city: true,
        addressLine: true,
        status: true,
        isOpen: true,
        deliveryFee: true,
        commissionBps: true,
        ratingAvg: true,
        ratingCount: true,
        createdAt: true,
        owner: { select: { id: true, fullName: true, phone: true, status: true } },
        _count: { select: { products: true, orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.shop.count({ where }),
  ]);
  return paginated(items, total, query);
}

const SHOP_ACTION = {
  APPROVED: 'SHOP_APPROVED',
  REJECTED: 'SHOP_REJECTED',
  SUSPENDED: 'SHOP_SUSPENDED',
} as const;

export async function setShopStatus(
  actor: { id: string; role: Role },
  shopId: string,
  status: 'APPROVED' | 'REJECTED' | 'SUSPENDED',
  reason: string | undefined,
  ip?: string,
) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, status: true, ownerId: true },
  });
  if (!shop) throw notFound('المحل غير موجود');

  const wasApproved = shop.status === 'APPROVED';
  const updated = await prisma.shop.update({
    where: { id: shopId },
    data: { status, ...(status === 'APPROVED' ? {} : { isOpen: false }) },
    select: { id: true, name: true, status: true, isOpen: true },
  });

  await prisma.notification.create({
    data: {
      userId: shop.ownerId,
      type: status === 'APPROVED' ? 'ACCOUNT_APPROVED' : 'ACCOUNT_REJECTED',
      title: status === 'APPROVED' ? 'تم اعتماد محلك' : 'تحديث حالة محلك',
      body:
        status === 'APPROVED'
          ? 'يمكنك الآن فتح المحل واستقبال الطلبات.'
          : `حالة محلك الآن: ${status === 'REJECTED' ? 'مرفوض' : 'معلّق'}.${
              reason ? ' السبب: ' + reason : ''
            }`,
    },
  });

  await audit({
    actorId: actor.id,
    action:
      status === 'APPROVED' && !wasApproved
        ? 'SHOP_APPROVED'
        : status === 'APPROVED'
          ? 'SHOP_REACTIVATED'
          : SHOP_ACTION[status],
    targetType: 'shop',
    targetId: shopId,
    metadata: { from: shop.status, to: status, reason },
    ipAddress: ip,
  });

  return updated;
}

export async function setShopCommission(
  actor: { id: string; role: Role },
  shopId: string,
  commissionBps: number,
  ip?: string,
) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { commissionBps: true },
  });
  if (!shop) throw notFound('المحل غير موجود');

  const updated = await prisma.shop.update({
    where: { id: shopId },
    data: { commissionBps },
    select: { id: true, name: true, commissionBps: true },
  });

  await audit({
    actorId: actor.id,
    action: 'SHOP_COMMISSION_CHANGED',
    targetType: 'shop',
    targetId: shopId,
    metadata: { from: shop.commissionBps, to: commissionBps },
    ipAddress: ip,
  });

  return updated;
}

/* ───────────────────────── الموصّلون ───────────────────────── */

export async function listDrivers(query: Pagination & { status?: string; q?: string }) {
  const where = {
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.q
      ? {
          user: {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' as const } },
              { phone: { contains: query.q } },
            ],
          },
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.driverProfile.findMany({
      where,
      select: {
        id: true,
        status: true,
        isAvailable: true,
        vehicleType: true,
        plateNumber: true,
        ratingAvg: true,
        ratingCount: true,
        currentOrderId: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, phone: true, status: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.driverProfile.count({ where }),
  ]);
  return paginated(items, total, query);
}

const DRIVER_ACTION = {
  APPROVED: 'DRIVER_APPROVED',
  REJECTED: 'DRIVER_REJECTED',
  SUSPENDED: 'DRIVER_SUSPENDED',
} as const;

export async function setDriverStatus(
  actor: { id: string; role: Role },
  driverId: string,
  status: 'APPROVED' | 'REJECTED' | 'SUSPENDED',
  reason: string | undefined,
  ip?: string,
) {
  const driver = await prisma.driverProfile.findUnique({
    where: { id: driverId },
    select: { id: true, status: true, userId: true },
  });
  if (!driver) throw notFound('الموصّل غير موجود');

  const wasApproved = driver.status === 'APPROVED';
  const updated = await prisma.driverProfile.update({
    where: { id: driverId },
    data: { status, ...(status === 'APPROVED' ? {} : { isAvailable: false }) },
    select: { id: true, status: true, isAvailable: true },
  });

  await prisma.notification.create({
    data: {
      userId: driver.userId,
      type: status === 'APPROVED' ? 'ACCOUNT_APPROVED' : 'ACCOUNT_REJECTED',
      title: status === 'APPROVED' ? 'تم اعتماد حسابك' : 'تحديث حالة حسابك',
      body:
        status === 'APPROVED'
          ? 'يمكنك الآن تفعيل التوفر واستقبال طلبات التوصيل.'
          : `حالة حسابك الآن: ${status === 'REJECTED' ? 'مرفوض' : 'معلّق'}.${
              reason ? ' السبب: ' + reason : ''
            }`,
    },
  });

  await audit({
    actorId: actor.id,
    action:
      status === 'APPROVED' && !wasApproved
        ? 'DRIVER_APPROVED'
        : status === 'APPROVED'
          ? 'DRIVER_REACTIVATED'
          : DRIVER_ACTION[status],
    targetType: 'driver',
    targetId: driverId,
    metadata: { from: driver.status, to: status, reason },
    ipAddress: ip,
  });

  return updated;
}

/* ───────────────────────── الطلبات ───────────────────────── */

export async function listOrders(
  query: Pagination & { status?: string; shopId?: string; q?: string },
) {
  const where = {
    ...(query.status ? { status: query.status as never } : {}),
    ...(query.shopId ? { shopId: query.shopId } : {}),
    ...(query.q ? { code: { contains: query.q.toUpperCase() } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        code: true,
        status: true,
        subtotal: true,
        deliveryFee: true,
        total: true,
        commissionAmount: true,
        driverEarning: true,
        createdAt: true,
        deliveredAt: true,
        customer: { select: { id: true, fullName: true, phone: true } },
        shop: { select: { id: true, name: true } },
        driver: { select: { id: true, user: { select: { fullName: true, phone: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.order.count({ where }),
  ]);
  return paginated(items, total, query);
}

/* ───────────────────────── الإحصائيات ───────────────────────── */

export async function getStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    customers,
    shops,
    drivers,
    pendingShops,
    pendingDrivers,
    todayOrders,
    delivered,
    cancelled,
    revenue,
    commission,
    todayRevenue,
  ] = await Promise.all([
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    prisma.shop.count({ where: { status: 'APPROVED' } }),
    prisma.driverProfile.count({ where: { status: 'APPROVED' } }),
    prisma.shop.count({ where: { status: 'PENDING' } }),
    prisma.driverProfile.count({ where: { status: 'PENDING' } }),
    prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.order.count({ where: { status: 'DELIVERED' } }),
    prisma.order.count({
      where: { status: { in: ['CANCELLED', 'REJECTED', 'FAILED_DELIVERY'] } },
    }),
    prisma.order.aggregate({ where: { status: 'DELIVERED' }, _sum: { total: true } }),
    prisma.order.aggregate({
      where: { status: 'DELIVERED' },
      _sum: { commissionAmount: true },
    }),
    prisma.order.aggregate({
      where: { status: 'DELIVERED', deliveredAt: { gte: startOfDay } },
      _sum: { total: true },
    }),
  ]);

  return {
    customers,
    shops,
    drivers,
    pendingShops,
    pendingDrivers,
    todayOrders,
    deliveredOrders: delivered,
    cancelledOrders: cancelled,
    grossRevenue: revenue._sum.total ?? 0,
    platformCommission: commission._sum.commissionAmount ?? 0,
    todayRevenue: todayRevenue._sum.total ?? 0,
  };
}

/* ───────────────────────── سجل العمليات ───────────────────────── */

export async function listAuditLog(
  query: Pagination & { actorId?: string; targetType?: string },
) {
  const where = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.targetType ? { targetType: query.targetType } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.adminAuditLog.count({ where }),
  ]);
  return paginated(items, total, query);
}
