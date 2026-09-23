/**
 * قُفّة — بيانات تجريبية للتطوير فقط.
 * لا تحتوي أي بيانات حقيقية. ترفض العمل في بيئة الإنتاج.
 *
 * كلمة مرور الحسابات التجريبية تُقرأ من SEED_DEMO_PASSWORD (افتراضي: Qoffa@1234).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { env } from '../src/config/env.js';
import { hashPassword } from '../src/lib/password.js';
import { generateOrderCode } from '../src/lib/code.js';
import { haversineMeters } from '../src/lib/geo.js';
import { applyBps } from '../src/lib/money.js';
import { seedPlatformOwner } from './seed-owner.js';

/** حصة قفة الافتراضية من رسوم التوصيل (نفس DEFAULT_PLATFORM_FEE في services/deliveryPricing.ts) */
const DEFAULT_PLATFORM_FEE = 30;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'Qoffa@1234';

// وسط الجزائر العاصمة كمرجع للإحداثيات التجريبية
const CENTER = { lat: 36.7538, lon: 3.0588 };
const jitter = (base: number, km: number) => base + (Math.random() - 0.5) * (km / 111);

const PRODUCT_CATEGORIES = [
  { name: 'مواد غذائية أساسية', slug: 'basics', iconKey: 'basket', sortOrder: 1 },
  { name: 'حليب ومشتقاته', slug: 'dairy', iconKey: 'milk', sortOrder: 2 },
  { name: 'خضر وفواكه', slug: 'produce', iconKey: 'carrot', sortOrder: 3 },
  { name: 'مخبوزات', slug: 'bakery', iconKey: 'bread', sortOrder: 4 },
  { name: 'مشروبات', slug: 'drinks', iconKey: 'bottle', sortOrder: 5 },
  { name: 'منظفات', slug: 'cleaning', iconKey: 'spray', sortOrder: 6 },
];

const SHOP_CATEGORIES = [
  { name: 'حانوت عام', slug: 'general-store', iconKey: 'store', sortOrder: 1 },
  { name: 'سوبيرات', slug: 'supermarket', iconKey: 'cart', sortOrder: 2 },
  { name: 'مخبزة', slug: 'bakery-shop', iconKey: 'bread', sortOrder: 3 },
];

const SHOPS = [
  {
    name: 'حانوت الأمين',
    description: 'مواد غذائية عامة — خدمة سريعة وأسعار مناسبة',
    city: 'الجزائر الوسطى',
    addressLine: 'شارع ديدوش مراد، رقم 24',
    phone: '0551110001',
    ownerName: 'الأمين بلقاسم',
    ownerPhone: '0551110001',
    deliveryFee: 150,
  },
  {
    name: 'سوبيرات النجاح',
    description: 'كل ما تحتاجه البيت في مكان واحد',
    city: 'باب الزوار',
    addressLine: 'حي 5 جويلية، عمارة ب',
    phone: '0551110002',
    ownerName: 'سمير حداد',
    ownerPhone: '0551110002',
    deliveryFee: 200,
  },
  {
    name: 'مخبزة الفجر',
    description: 'خبز طازج يوميًا ومخبوزات تقليدية',
    city: 'حسين داي',
    addressLine: 'شارع العقيد لطفي، رقم 8',
    phone: '0551110003',
    ownerName: 'كريمة مزياني',
    ownerPhone: '0551110003',
    deliveryFee: 120,
  },
];

const PRODUCTS: Array<{ name: string; price: number; unit: string; cat: string }> = [
  { name: 'حليب كامل الدسم 1 لتر', price: 120, unit: 'لتر', cat: 'dairy' },
  { name: 'ياغورت طبيعي', price: 45, unit: 'علبة', cat: 'dairy' },
  { name: 'جبن مثلثات', price: 260, unit: 'علبة', cat: 'dairy' },
  { name: 'زبدة 250غ', price: 340, unit: 'قطعة', cat: 'dairy' },
  { name: 'خبز تقليدي', price: 25, unit: 'قطعة', cat: 'bakery' },
  { name: 'باغيت', price: 15, unit: 'قطعة', cat: 'bakery' },
  { name: 'كرواسون', price: 60, unit: 'قطعة', cat: 'bakery' },
  { name: 'سميد 5 كغ', price: 480, unit: 'كيس', cat: 'basics' },
  { name: 'دقيق 1 كغ', price: 110, unit: 'كيس', cat: 'basics' },
  { name: 'أرز 1 كغ', price: 190, unit: 'كيس', cat: 'basics' },
  { name: 'زيت مائدة 5 لتر', price: 1050, unit: 'بيدون', cat: 'basics' },
  { name: 'سكر 1 كغ', price: 130, unit: 'كيس', cat: 'basics' },
  { name: 'معجون طماطم', price: 95, unit: 'علبة', cat: 'basics' },
  { name: 'طماطم طازجة', price: 140, unit: 'كغ', cat: 'produce' },
  { name: 'بطاطا', price: 90, unit: 'كغ', cat: 'produce' },
  { name: 'بصل', price: 80, unit: 'كغ', cat: 'produce' },
  { name: 'موز', price: 450, unit: 'كغ', cat: 'produce' },
  { name: 'ماء معدني 1.5 لتر', price: 40, unit: 'قارورة', cat: 'drinks' },
  { name: 'مشروب غازي 2 لتر', price: 160, unit: 'قارورة', cat: 'drinks' },
  { name: 'ماء جافيل 1 لتر', price: 85, unit: 'قارورة', cat: 'cleaning' },
];

const CUSTOMERS = [
  { fullName: 'ياسين مرابط', phone: '0661110001' },
  { fullName: 'نسرين قاسمي', phone: '0661110002' },
  { fullName: 'عبد الرؤوف زيان', phone: '0661110003' },
  { fullName: 'أمينة بوعلام', phone: '0661110004' },
  { fullName: 'رضا شريف', phone: '0661110005' },
];

const DRIVERS = [
  { fullName: 'مهدي بوزيد', phone: '0771110001', vehicleType: 'دراجة نارية' },
  { fullName: 'أنيس لعمارة', phone: '0771110002', vehicleType: 'دراجة نارية' },
  { fullName: 'وليد سعداوي', phone: '0771110003', vehicleType: 'سيارة' },
  { fullName: 'هشام بن عمر', phone: '0771110004', vehicleType: 'دراجة نارية' },
  { fullName: 'فؤاد تواتي', phone: '0771110005', vehicleType: 'دراجة هوائية' },
];

async function main() {
  if (env.isProduction) {
    throw new Error('لا يجوز تشغيل البيانات التجريبية في بيئة الإنتاج.');
  }

  console.log('— قُفّة: تهيئة البيانات التجريبية —\n');

  // 1) مالك المنصة (دائمًا، حتى في الإنتاج يُشغَّل وحده)
  await seedPlatformOwner(prisma);

  // 2) تنظيف البيانات التجريبية السابقة (لا يمس حساب المالك)
  await prisma.walletTransaction.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.review.deleteMany();
  await prisma.deliveryOffer.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.orderStatusEvent.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.shopProduct.deleteMany();
  await prisma.product.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.shop.deleteMany();
  await prisma.driverProfile.deleteMany();
  await prisma.address.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.user.deleteMany({ where: { role: { not: 'SUPER_ADMIN' } } });
  await prisma.category.deleteMany();

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // 3) التصنيفات
  for (const c of PRODUCT_CATEGORIES) {
    await prisma.category.create({ data: { ...c, kind: 'PRODUCT' } });
  }
  for (const c of SHOP_CATEGORIES) {
    await prisma.category.create({ data: { ...c, kind: 'SHOP' } });
  }
  const categories = await prisma.category.findMany();
  const catBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  console.log(`✔ ${categories.length} تصنيف`);

  // 4) مدير عادي (ADMIN) للتجربة
  await prisma.user.create({
    data: {
      fullName: 'مدير تجريبي',
      phone: '0555000000',
      email: 'admin@qoffa.local',
      passwordHash,
      role: 'ADMIN',
    },
  });

  // 5) المنتجات العالمية (مرة واحدة، بباركود فريد) ثم المحلات وعروضها
  const globalProducts = new Map<string, string>();
  for (const [idx, p] of PRODUCTS.entries()) {
    const created = await prisma.product.create({
      data: {
        barcode: `613000000${String(idx + 1).padStart(4, '0')}`,
        name: p.name,
        unit: p.unit,
        categoryId: catBySlug.get(p.cat),
      },
      select: { id: true },
    });
    globalProducts.set(p.name, created.id);
  }
  console.log(`✔ ${globalProducts.size} منتج عالمي`);

  const shopIds: string[] = [];
  for (const [i, s] of SHOPS.entries()) {
    const lat = jitter(CENTER.lat, 6);
    const lon = jitter(CENTER.lon, 6);
    const shopCatSlug = i === 2 ? 'bakery-shop' : i === 1 ? 'supermarket' : 'general-store';

    const owner = await prisma.user.create({
      data: {
        fullName: s.ownerName,
        phone: s.ownerPhone,
        email: `shop${i + 1}@qoffa.local`,
        passwordHash,
        role: 'SHOP_OWNER',
        shop: {
          create: {
            name: s.name,
            description: s.description,
            phone: s.phone,
            addressLine: s.addressLine,
            city: s.city,
            latitude: lat,
            longitude: lon,
            status: 'APPROVED',
            isOpen: true,
            deliveryFee: s.deliveryFee,
            commissionBps: env.PLATFORM_COMMISSION_BPS,
            categoryId: catBySlug.get(shopCatSlug),
            wallet: { create: { ownerType: 'SHOP' } },
          },
        },
      },
      select: { shop: { select: { id: true } } },
    });

    const shopId = owner.shop!.id;
    shopIds.push(shopId);

    // كل محل يأخذ مجموعة من المنتجات (المخبزة تركّز على المخبوزات)
    const list =
      i === 2
        ? PRODUCTS.filter((p) => ['bakery', 'dairy', 'drinks'].includes(p.cat))
        : PRODUCTS;

    await prisma.shopProduct.createMany({
      data: list.map((p, idx) => ({
        shopId,
        productId: globalProducts.get(p.name)!,
        price: p.price + i * 5,
        isAvailable: idx % 11 !== 0, // بعض المنتجات غير متوفرة لاختبار الحالة
        isHidden: false,
      })),
    });
  }
  const productCount = await prisma.shopProduct.count();
  console.log(`✔ ${SHOPS.length} محلات، ${productCount} منتج`);

  // 6) الزبائن + عناوينهم
  const customerIds: string[] = [];
  for (const [i, c] of CUSTOMERS.entries()) {
    const user = await prisma.user.create({
      data: {
        fullName: c.fullName,
        phone: c.phone,
        email: `customer${i + 1}@qoffa.local`,
        passwordHash,
        role: 'CUSTOMER',
        customerProfile: { create: {} },
      },
      select: { id: true },
    });
    const address = await prisma.address.create({
      data: {
        userId: user.id,
        label: 'المنزل',
        addressLine: `حي السلام، عمارة ${i + 1}، الطابق ${i + 1}`,
        city: 'الجزائر',
        latitude: jitter(CENTER.lat, 8),
        longitude: jitter(CENTER.lon, 8),
      },
    });
    await prisma.customerProfile.update({
      where: { userId: user.id },
      data: { defaultAddressId: address.id },
    });
    customerIds.push(user.id);
  }
  console.log(`✔ ${CUSTOMERS.length} زبائن`);

  // 7) الموصّلون
  const driverProfileIds: string[] = [];
  for (const [i, d] of DRIVERS.entries()) {
    const user = await prisma.user.create({
      data: {
        fullName: d.fullName,
        phone: d.phone,
        email: `driver${i + 1}@qoffa.local`,
        passwordHash,
        role: 'DRIVER',
        driverProfile: {
          create: {
            vehicleType: d.vehicleType,
            plateNumber: `1234${i}-119-16`,
            status: 'APPROVED',
            isAvailable: i < 3,
            latitude: jitter(CENTER.lat, 5),
            longitude: jitter(CENTER.lon, 5),
            lastLocationAt: new Date(),
            wallet: { create: { ownerType: 'DRIVER' } },
          },
        },
      },
      select: { driverProfile: { select: { id: true } } },
    });
    driverProfileIds.push(user.driverProfile!.id);
  }
  console.log(`✔ ${DRIVERS.length} موصّلين`);

  // 8) طلبات في مراحل مختلفة
  const statuses = [
    'PENDING',
    'PREPARING',
    'READY_FOR_PICKUP',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'CANCELLED',
  ] as const;

  for (const [i, status] of statuses.entries()) {
    const shopId = shopIds[i % shopIds.length]!;
    const customerId = customerIds[i % customerIds.length]!;

    const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
    const address = await prisma.address.findFirstOrThrow({ where: { userId: customerId } });
    const customer = await prisma.user.findUniqueOrThrow({ where: { id: customerId } });
    const products = await prisma.shopProduct.findMany({
      where: { shopId },
      take: 3,
      include: { product: { select: { name: true, unit: true } } },
    });

    const items = products.map((p, idx) => ({
      productId: p.id,
      nameSnapshot: p.product.name,
      unitSnapshot: p.product.unit,
      unitPrice: p.price,
      quantity: idx + 1,
      lineTotal: p.price * (idx + 1),
    }));
    const subtotal = items.reduce((s, it) => s + it.lineTotal, 0);
    const total = subtotal + shop.deliveryFee;
    const distance = haversineMeters(
      shop.latitude,
      shop.longitude,
      address.latitude,
      address.longitude,
    );

    const delivered = status === 'DELIVERED';
    const needsDriver = ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(status);
    const driverId = needsDriver ? driverProfileIds[3 + (i % 2)]! : null;

    const now = Date.now();
    const order = await prisma.order.create({
      data: {
        code: generateOrderCode(),
        customerId,
        shopId,
        driverId,
        status,
        subtotal,
        deliveryFee: shop.deliveryFee,
        total,
        commissionAmount: delivered ? applyBps(subtotal, shop.commissionBps) : 0,
        platformFee: Math.min(DEFAULT_PLATFORM_FEE, shop.deliveryFee),
        driverEarning: delivered
          ? shop.deliveryFee - Math.min(DEFAULT_PLATFORM_FEE, shop.deliveryFee)
          : 0,
        customerNote: i % 2 === 0 ? 'الرجاء الاتصال عند الوصول' : null,
        addressId: address.id,
        deliveryAddressLine: address.addressLine,
        deliveryCity: address.city,
        deliveryLatitude: address.latitude,
        deliveryLongitude: address.longitude,
        customerPhone: customer.phone,
        distanceMeters: distance,
        cancelledBy: status === 'CANCELLED' ? 'CUSTOMER' : null,
        cancelReason: status === 'CANCELLED' ? 'غيّرت رأيي' : null,
        acceptedAt: status === 'PENDING' ? null : new Date(now - 40 * 60_000),
        preparingAt: ['PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(
          status,
        )
          ? new Date(now - 35 * 60_000)
          : null,
        readyAt: ['READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(status)
          ? new Date(now - 25 * 60_000)
          : null,
        assignedAt: needsDriver ? new Date(now - 20 * 60_000) : null,
        pickedUpAt: needsDriver ? new Date(now - 15 * 60_000) : null,
        outForDeliveryAt: needsDriver ? new Date(now - 14 * 60_000) : null,
        deliveredAt: delivered ? new Date(now - 5 * 60_000) : null,
        closedAt: delivered ? new Date(now - 5 * 60_000) : null,
        items: { createMany: { data: items } },
      },
    });

    if (needsDriver && driverId) {
      await prisma.delivery.create({
        data: {
          orderId: order.id,
          driverId,
          pickedUpAt: new Date(now - 15 * 60_000),
          deliveredAt: delivered ? new Date(now - 5 * 60_000) : null,
          distanceMeters: distance,
          earning: delivered ? shop.deliveryFee - Math.min(DEFAULT_PLATFORM_FEE, shop.deliveryFee) : 0,
        },
      });
      if (!delivered) {
        await prisma.driverProfile.update({
          where: { id: driverId },
          data: { currentOrderId: order.id, isAvailable: true },
        });
      }
    }

    await prisma.orderStatusEvent.create({
      data: {
        orderId: order.id,
        fromStatus: null,
        toStatus: status,
        actorType: 'SYSTEM',
        note: 'بيانات تجريبية',
      },
    });
  }
  console.log(`✔ ${statuses.length} طلبات بمراحل مختلفة`);

  // 9) إعدادات المنصة الافتراضية
  const settings = [
    { key: 'platform.commissionBps', value: env.PLATFORM_COMMISSION_BPS, label: 'عمولة المنصة (نقاط أساسية)', group: 'finance' },
    { key: 'platform.defaultDeliveryFee', value: env.DEFAULT_DELIVERY_FEE, label: 'رسوم التوصيل الافتراضية (دج)', group: 'finance' },
    { key: 'delivery.platformFee', value: DEFAULT_PLATFORM_FEE, label: 'حصة قفة من رسوم التوصيل (دج)', group: 'delivery' },
    { key: 'platform.searchRadiusKm', value: env.SEARCH_RADIUS_KM, label: 'نصف قطر البحث (كم)', group: 'matching' },
    { key: 'platform.driverOfferTimeoutSeconds', value: env.DRIVER_OFFER_TIMEOUT_SECONDS, label: 'مهلة قبول الموصّل (ثانية)', group: 'matching' },
    { key: 'platform.maxDriverOffers', value: env.MAX_DRIVER_OFFERS, label: 'أقصى عدد عروض قبل NO_DRIVER', group: 'matching' },
  ];
  for (const s of settings) {
    await prisma.platformSetting.upsert({
      where: { key: s.key },
      update: { value: s.value, label: s.label, group: s.group },
      create: s,
    });
  }
  console.log(`✔ ${settings.length} إعدادات منصة`);

  console.log(`\nحسابات تجريبية (كلمة المرور: ${DEMO_PASSWORD})`);
  console.log('  زبون   : 0661110001');
  console.log('  محل    : 0551110001');
  console.log('  موصّل  : 0771110001');
  console.log('  مدير   : 0555000000');
  console.log('\nتمت التهيئة.\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
