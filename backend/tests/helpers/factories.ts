import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signToken } from '../../src/lib/jwt.js';
import type { ApprovalStatus } from '../../src/generated/prisma/enums.js';

export const TEST_PASSWORD = 'Test@12345';

let counter = 0;
/** رقم هاتف جزائري فريد لكل كيان تجريبي */
export function uniquePhone(prefix = '05'): string {
  counter += 1;
  return `${prefix}${String(10_000_000 + counter).padStart(8, '0')}`.slice(0, 10);
}

export const ALGIERS = { lat: 36.7538, lon: 3.0588 };

/** يمسح كل البيانات بترتيب يحترم المفاتيح الأجنبية */
export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "WalletTransaction", "Wallet", "Notification", "Review",
      "DeliveryOffer", "Delivery", "OrderStatusEvent", "OrderItem", "Order",
      "ShopProduct", "Shop", "DriverProfile", "Address", "CustomerProfile",
      "AdminAuditLog", "PlatformSetting", "Category", "User"
    RESTART IDENTITY CASCADE;
  `);
}

export async function createCustomer(overrides: { fullName?: string } = {}) {
  const phone = uniquePhone('06');
  const user = await prisma.user.create({
    data: {
      fullName: overrides.fullName ?? 'زبون اختبار',
      phone,
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: 'CUSTOMER',
      customerProfile: { create: {} },
    },
  });
  const address = await prisma.address.create({
    data: {
      userId: user.id,
      addressLine: 'حي الاختبار، عمارة 1',
      city: 'الجزائر',
      latitude: ALGIERS.lat + 0.01,
      longitude: ALGIERS.lon + 0.01,
    },
  });
  await prisma.customerProfile.update({
    where: { userId: user.id },
    data: { defaultAddressId: address.id },
  });
  return { user, address, phone, token: signToken({ sub: user.id, role: 'CUSTOMER' }) };
}

export async function createShop(
  options: { status?: ApprovalStatus; isOpen?: boolean; deliveryFee?: number } = {},
) {
  const phone = uniquePhone('05');
  const owner = await prisma.user.create({
    data: {
      fullName: 'صاحب محل اختبار',
      phone,
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: 'SHOP_OWNER',
      shop: {
        create: {
          name: 'محل الاختبار',
          phone,
          addressLine: 'شارع الاختبار 1',
          city: 'الجزائر',
          latitude: ALGIERS.lat,
          longitude: ALGIERS.lon,
          status: options.status ?? 'APPROVED',
          isOpen: options.isOpen ?? true,
          deliveryFee: options.deliveryFee ?? 150,
          wallet: { create: { ownerType: 'SHOP' } },
        },
      },
    },
    include: { shop: true },
  });
  return {
    owner,
    shop: owner.shop!,
    phone,
    token: signToken({ sub: owner.id, role: 'SHOP_OWNER' }),
  };
}

export async function createProduct(
  shopId: string,
  overrides: { name?: string; price?: number; isAvailable?: boolean; isHidden?: boolean } = {},
) {
  return prisma.shopProduct.create({
    data: {
      shopId,
      name: overrides.name ?? 'منتج اختبار',
      price: overrides.price ?? 100,
      unit: 'قطعة',
      isAvailable: overrides.isAvailable ?? true,
      isHidden: overrides.isHidden ?? false,
    },
  });
}

export async function createDriver(
  options: { status?: ApprovalStatus; isAvailable?: boolean; lat?: number; lon?: number } = {},
) {
  const phone = uniquePhone('07');
  const user = await prisma.user.create({
    data: {
      fullName: 'موصّل اختبار',
      phone,
      passwordHash: await hashPassword(TEST_PASSWORD),
      role: 'DRIVER',
      driverProfile: {
        create: {
          status: options.status ?? 'APPROVED',
          isAvailable: options.isAvailable ?? true,
          latitude: options.lat ?? ALGIERS.lat,
          longitude: options.lon ?? ALGIERS.lon,
          lastLocationAt: new Date(),
          wallet: { create: { ownerType: 'DRIVER' } },
        },
      },
    },
    include: { driverProfile: true },
  });
  return {
    user,
    profile: user.driverProfile!,
    phone,
    token: signToken({ sub: user.id, role: 'DRIVER' }),
  };
}

export async function createAdmin(role: 'ADMIN' | 'SUPER_ADMIN' = 'ADMIN') {
  const phone = uniquePhone('05');
  const user = await prisma.user.create({
    data: {
      fullName: role === 'SUPER_ADMIN' ? 'مالك المنصة' : 'مدير',
      phone,
      email: `${role.toLowerCase()}.${phone}@test.local`,
      passwordHash: await hashPassword(TEST_PASSWORD),
      role,
    },
  });
  return { user, phone, token: signToken({ sub: user.id, role }) };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
