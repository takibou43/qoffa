import { conflict, forbidden, unauthorized } from '../../lib/errors.js';
import { signToken } from '../../lib/jwt.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import type { Role } from '../../generated/prisma/enums.js';
import type {
  LoginInput,
  RegisterCustomerInput,
  RegisterDriverInput,
  RegisterShopInput,
} from './auth.schema.js';

/**
 * الأدوار المسموح إنشاؤها من التسجيل العام.
 * ADMIN و SUPER_ADMIN غير مسموح بهما إطلاقًا هنا — تُنشأ فقط عبر seed أو من SUPER_ADMIN.
 */
const PUBLIC_ROLES = ['CUSTOMER', 'SHOP_OWNER', 'DRIVER'] as const;
export type PublicRole = (typeof PUBLIC_ROLES)[number];

export function assertPublicRole(role: string): asserts role is PublicRole {
  if (!PUBLIC_ROLES.includes(role as PublicRole)) {
    throw forbidden('لا يمكن إنشاء هذا النوع من الحسابات من التسجيل العام');
  }
}

/** الحقول العامة للمستخدم — لا تتضمن أبدًا passwordHash */
export const publicUserSelect = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  role: true,
  status: true,
  mustChangePassword: true,
  createdAt: true,
} as const;

async function ensureUnique(phone: string, email?: string | null) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone }, ...(email ? [{ email }] : [])] },
    select: { phone: true, email: true },
  });
  if (existing) {
    if (existing.phone === phone) throw conflict('رقم الهاتف مستعمل مسبقًا');
    throw conflict('البريد الإلكتروني مستعمل مسبقًا');
  }
}

function normalizeEmail(email?: string) {
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export async function registerCustomer(input: RegisterCustomerInput) {
  const email = normalizeEmail(input.email);
  await ensureUnique(input.phone, email);

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone: input.phone,
      email,
      passwordHash: await hashPassword(input.password),
      role: 'CUSTOMER',
      customerProfile: { create: {} },
    },
    select: publicUserSelect,
  });

  return { user, token: signToken({ sub: user.id, role: user.role }) };
}

export async function registerShopOwner(input: RegisterShopInput) {
  const email = normalizeEmail(input.email);
  await ensureUnique(input.phone, email);

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone: input.phone,
      email,
      passwordHash: await hashPassword(input.password),
      role: 'SHOP_OWNER',
      shop: {
        create: {
          name: input.shop.name,
          description: input.shop.description,
          phone: input.shop.phone,
          addressLine: input.shop.addressLine,
          city: input.shop.city,
          latitude: input.shop.latitude,
          longitude: input.shop.longitude,
          categoryId: input.shop.categoryId,
          // المحل يبدأ قيد المراجعة — لا يظهر للزبائن حتى توافق الإدارة
          status: 'PENDING',
          isOpen: false,
          wallet: { create: { ownerType: 'SHOP' } },
        },
      },
    },
    select: { ...publicUserSelect, shop: { select: { id: true, name: true, status: true } } },
  });

  return { user, token: signToken({ sub: user.id, role: user.role }) };
}

export async function registerDriver(input: RegisterDriverInput) {
  const email = normalizeEmail(input.email);
  await ensureUnique(input.phone, email);

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      phone: input.phone,
      email,
      passwordHash: await hashPassword(input.password),
      role: 'DRIVER',
      driverProfile: {
        create: {
          vehicleType: input.driver.vehicleType,
          plateNumber: input.driver.plateNumber,
          status: 'PENDING',
          isAvailable: false,
          wallet: { create: { ownerType: 'DRIVER' } },
        },
      },
    },
    select: {
      ...publicUserSelect,
      driverProfile: { select: { id: true, status: true, isAvailable: true } },
    },
  });

  return { user, token: signToken({ sub: user.id, role: user.role }) };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { phone: input.phone },
    select: { ...publicUserSelect, passwordHash: true },
  });

  // نفس الرسالة في الحالتين حتى لا يُستدل على وجود الحساب
  const invalid = () => unauthorized('رقم الهاتف أو كلمة المرور غير صحيحة');
  if (!user) {
    // نُنفّذ مقارنة وهمية لتقريب زمن الاستجابة
    await verifyPassword(input.password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw invalid();
  }

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw invalid();

  if (user.status === 'SUSPENDED') {
    throw forbidden('تم تعليق هذا الحساب. تواصل مع إدارة المنصة.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const { passwordHash: _ignored, ...safeUser } = user;
  return { user: safeUser, token: signToken({ sub: user.id, role: user.role as Role }) };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true },
  });

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw unauthorized('كلمة المرور الحالية غير صحيحة');

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
    },
  });
}

/** الملف الشخصي الكامل حسب الدور — يستعمله كل تطبيق عند الإقلاع */
export async function getMe(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      ...publicUserSelect,
      customerProfile: { select: { id: true, defaultAddressId: true } },
      shop: {
        select: {
          id: true,
          name: true,
          status: true,
          isOpen: true,
          imageUrl: true,
          deliveryFee: true,
          ratingAvg: true,
          ratingCount: true,
        },
      },
      driverProfile: {
        select: {
          id: true,
          status: true,
          isAvailable: true,
          vehicleType: true,
          currentOrderId: true,
          ratingAvg: true,
          ratingCount: true,
        },
      },
    },
  });
}
