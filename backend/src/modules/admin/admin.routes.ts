import express, { Router } from 'express';
import { MAX_IMAGE_BYTES } from '../../lib/image.js';
import { env } from '../../config/env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { clientIp, param } from '../../lib/http.js';
import { paginationSchema, type Pagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { requireAdmin, requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { validate, validated } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { loadPricingConfig, savePricingConfig } from '../../services/deliveryPricing.js';
import { transitionOrder } from '../orders/orders.service.js';
import {
  adminListProducts,
  adminRemoveProductImage,
  adminSetProductImage,
  adminUpdateGlobalProduct,
  flattenListing,
  listingSelect,
} from '../products/products.service.js';
import {
  adminProductsQuery,
  adminUpdateProductSchema,
  type AdminProductsQuery,
} from '../products/products.schema.js';
import { adminForceStatusSchema } from '../orders/orders.schema.js';
import {
  approvalSchema,
  commissionSchema,
  createAdminSchema,
  deliveryPricingSchema,
  listAuditQuery,
  listDriversQuery,
  listOrdersAdminQuery,
  listShopsQuery,
  listUsersQuery,
  setUserStatusSchema,
  settingSchema,
  walletAdjustSchema,
} from './admin.schema.js';
import * as service from './admin.service.js';

export const adminRouter = Router();

// كل المسارات هنا تتطلب دورًا إداريًا مُتحققًا في الخادم
adminRouter.use(requireAuth, requireAdmin);

const actor = (req: { auth?: { userId: string; role: string } }) => ({
  id: req.auth!.userId,
  role: req.auth!.role as never,
});

/* ───────── الإحصائيات ───────── */

adminRouter.get('/stats', async (_req, res) => {
  res.json({ stats: await service.getStats() });
});

/* ───────── هوية المنصة (للوحة الإدارة فقط) ───────── */

adminRouter.get('/platform', async (_req, res) => {
  const owner = env.platformOwnerEmail
    ? await prisma.user.findUnique({
        where: { email: env.platformOwnerEmail },
        select: { fullName: true, email: true, createdAt: true },
      })
    : null;

  res.json({
    platform: {
      name: 'قُفّة',
      tagline: 'من حانوتك إلى بابك.',
      currency: 'DZD',
      // يُعرض لمدراء المنصة فقط — لا يظهر لأي زبون أو محل أو موصّل
      owner: owner ? { name: owner.fullName, email: owner.email } : null,
    },
  });
});

/* ───────── المستخدمون ───────── */

adminRouter.get('/users', validate(listUsersQuery, 'query'), async (_req, res) => {
  res.json(await service.listUsers(validated(res, 'query')));
});

adminRouter.patch(
  '/users/:userId/status',
  writeLimiter,
  validate(setUserStatusSchema),
  async (req, res) => {
    const user = await service.setUserStatus(
      actor(req),
      param(req, 'userId'),
      req.body.status,
      req.body.reason,
      clientIp(req),
    );
    res.json({ user });
  },
);

/* ───────── المدراء — لمالك المنصة فقط ───────── */

adminRouter.post(
  '/admins',
  requireSuperAdmin,
  writeLimiter,
  validate(createAdminSchema),
  async (req, res) => {
    const user = await service.createAdmin(actor(req), req.body, clientIp(req));
    res.status(201).json({ user });
  },
);

adminRouter.delete('/admins/:userId', requireSuperAdmin, writeLimiter, async (req, res) => {
  await service.removeAdmin(actor(req), param(req, 'userId'), clientIp(req));
  res.json({ ok: true });
});

/* ───────── المحلات ───────── */

adminRouter.get('/shops', validate(listShopsQuery, 'query'), async (_req, res) => {
  res.json(await service.listShops(validated(res, 'query')));
});

adminRouter.patch(
  '/shops/:shopId/status',
  writeLimiter,
  validate(approvalSchema),
  async (req, res) => {
    const shop = await service.setShopStatus(
      actor(req),
      param(req, 'shopId'),
      req.body.status,
      req.body.reason,
      clientIp(req),
    );
    res.json({ shop });
  },
);

adminRouter.patch(
  '/shops/:shopId/commission',
  requireSuperAdmin,
  writeLimiter,
  validate(commissionSchema),
  async (req, res) => {
    const shop = await service.setShopCommission(
      actor(req),
      param(req, 'shopId'),
      req.body.commissionBps,
      clientIp(req),
    );
    res.json({ shop });
  },
);

adminRouter.get(
  '/shops/:shopId/products',
  validate(paginationSchema, 'query'),
  async (req, res) => {
    const pagination = validated<Pagination>(res, 'query');
    const shopId = param(req, 'shopId');
    const [items, total] = await Promise.all([
      prisma.shopProduct.findMany({
        where: { shopId },
        select: listingSelect,
        orderBy: { updatedAt: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      prisma.shopProduct.count({ where: { shopId } }),
    ]);
    res.json({ items: items.map(flattenListing), meta: { ...pagination, total } });
  },
);

/** المنتجات العالمية (كتالوج المنصة) مع عدد المحلات التي تعرض كل منتج */
adminRouter.get('/products', validate(adminProductsQuery, 'query'), async (_req, res) => {
  res.json(await adminListProducts(validated<AdminProductsQuery>(res, 'query')));
});

/** استبدال/إضافة صورة المنتج العالمي — تظهر فورًا عند كل المحلات والزبائن */
adminRouter.put(
  '/products/:productId/image',
  writeLimiter,
  express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }),
  async (req, res) => {
    const productId = param(req, 'productId');
    const { product, previousImageUrl, image } = await adminSetProductImage(
      productId,
      req.body,
      req.headers['content-type'],
    );
    await audit({
      actorId: req.auth!.userId,
      action: 'PRODUCT_UPDATED',
      targetType: 'product',
      targetId: productId,
      metadata: {
        barcode: product.barcode,
        image: previousImageUrl ? 'replaced' : 'added',
        before: previousImageUrl,
        after: product.imageUrl,
        bytes: image.bytes,
      },
      ipAddress: clientIp(req),
    });
    res.json({ product });
  },
);

/** حذف صورة المنتج العالمي فقط — المنتج وعروض المحلات والطلبات القديمة تبقى كما هي */
adminRouter.delete('/products/:productId/image', writeLimiter, async (req, res) => {
  const productId = param(req, 'productId');
  const { product, previousImageUrl } = await adminRemoveProductImage(productId);
  await audit({
    actorId: req.auth!.userId,
    action: 'PRODUCT_UPDATED',
    targetType: 'product',
    targetId: productId,
    metadata: { barcode: product.barcode, image: 'removed', before: previousImageUrl },
    ipAddress: clientIp(req),
  });
  res.json({ product });
});

/** تعديل بيانات المنتج العالمي — يؤثر على كل المحلات التي تعرضه، لذا للإدارة فقط */
adminRouter.patch(
  '/products/:productId',
  writeLimiter,
  validate(adminUpdateProductSchema),
  async (req, res) => {
    const productId = param(req, 'productId');
    const { before, after } = await adminUpdateGlobalProduct(productId, req.body);
    await audit({
      actorId: req.auth!.userId,
      action: 'PRODUCT_UPDATED',
      targetType: 'product',
      targetId: productId,
      metadata: { barcode: before.barcode, changes: req.body },
      ipAddress: clientIp(req),
    });
    res.json({ product: after });
  },
);

/* ───────── الموصّلون ───────── */

adminRouter.get('/drivers', validate(listDriversQuery, 'query'), async (_req, res) => {
  res.json(await service.listDrivers(validated(res, 'query')));
});

adminRouter.patch(
  '/drivers/:driverId/status',
  writeLimiter,
  validate(approvalSchema),
  async (req, res) => {
    const driver = await service.setDriverStatus(
      actor(req),
      param(req, 'driverId'),
      req.body.status,
      req.body.reason,
      clientIp(req),
    );
    res.json({ driver });
  },
);

/* ───────── الطلبات ───────── */

adminRouter.get('/orders', validate(listOrdersAdminQuery, 'query'), async (_req, res) => {
  res.json(await service.listOrders(validated(res, 'query')));
});

/** تدخّل إداري في حالة الطلب — يمر من آلة الحالات نفسها ويُسجَّل */
adminRouter.patch(
  '/orders/:orderId/status',
  writeLimiter,
  validate(adminForceStatusSchema),
  async (req, res) => {
    const orderId = param(req, 'orderId');
    const result = await transitionOrder(orderId, req.body.status, {
      actorType: 'ADMIN',
      actorId: req.auth!.userId,
      note: req.body.note,
      reason: req.body.note,
    });
    await audit({
      actorId: req.auth!.userId,
      action: 'ORDER_FORCE_STATUS',
      targetType: 'order',
      targetId: orderId,
      metadata: { ...result, note: req.body.note },
      ipAddress: clientIp(req),
    });
    res.json({ ok: true, ...result });
  },
);

/* ───────── المحافظ ───────── */

adminRouter.get('/wallets', validate(paginationSchema, 'query'), async (_req, res) => {
  const pagination = validated<Pagination>(res, 'query');
  const [items, total] = await Promise.all([
    prisma.wallet.findMany({
      select: {
        id: true,
        ownerType: true,
        balance: true,
        updatedAt: true,
        shop: { select: { id: true, name: true } },
        driver: { select: { id: true, user: { select: { fullName: true, phone: true } } } },
      },
      orderBy: { balance: 'desc' },
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    }),
    prisma.wallet.count(),
  ]);
  res.json({ items, meta: { ...pagination, total } });
});

adminRouter.get('/wallets/:walletId/transactions', async (req, res) => {
  const walletId = param(req, 'walletId');
  const items = await prisma.walletTransaction.findMany({
    where: { walletId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ items });
});

/** تعديل يدوي على رصيد محفظة — لمالك المنصة فقط، ومسجَّل دائمًا */
adminRouter.post(
  '/wallets/:walletId/adjust',
  requireSuperAdmin,
  writeLimiter,
  validate(walletAdjustSchema),
  async (req, res) => {
    const walletId = param(req, 'walletId');
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw notFound('المحفظة غير موجودة');

    const updated = await prisma.$transaction(async (tx) => {
      const w = await tx.wallet.update({
        where: { id: walletId },
        data: { balance: { increment: req.body.amount } },
      });
      await tx.walletTransaction.create({
        data: {
          walletId,
          type: 'ADJUSTMENT',
          amount: req.body.amount,
          description: req.body.description,
        },
      });
      return w;
    });

    await audit({
      actorId: req.auth!.userId,
      action: 'WALLET_ADJUSTED',
      targetType: 'wallet',
      targetId: walletId,
      metadata: {
        amount: req.body.amount,
        description: req.body.description,
        balanceAfter: updated.balance,
      },
      ipAddress: clientIp(req),
    });

    res.json({ wallet: updated });
  },
);

/* ───────── تسعير التوصيل بالمسافة ───────── */

adminRouter.get('/delivery-pricing', async (_req, res) => {
  res.json({ pricing: await loadPricingConfig() });
});

adminRouter.put(
  '/delivery-pricing',
  requireSuperAdmin,
  writeLimiter,
  validate(deliveryPricingSchema),
  async (req, res) => {
    const before = await loadPricingConfig();
    // حقل غير مُرسَل (مثل حصة قفة) يحتفظ بقيمته الحالية
    const next = { ...before, ...req.body };
    await savePricingConfig(next, req.auth!.userId);

    await audit({
      actorId: req.auth!.userId,
      action: 'SETTING_CHANGED',
      targetType: 'setting',
      targetId: 'delivery.pricing',
      metadata: { from: before, to: next },
      ipAddress: clientIp(req),
    });

    res.json({ pricing: await loadPricingConfig() });
  },
);

/* ───────── إعدادات المنصة ───────── */

adminRouter.get('/settings', async (_req, res) => {
  const items = await prisma.platformSetting.findMany({ orderBy: { key: 'asc' } });
  res.json({ items });
});

adminRouter.put(
  '/settings/:key',
  requireSuperAdmin,
  writeLimiter,
  validate(settingSchema),
  async (req, res) => {
    const key = param(req, 'key');
    if (!/^[a-zA-Z0-9.]{3,60}$/.test(key)) throw badRequest('مفتاح الإعداد غير صالح');

    const before = await prisma.platformSetting.findUnique({ where: { key } });
    const setting = await prisma.platformSetting.upsert({
      where: { key },
      update: {
        value: req.body.value,
        ...(req.body.label ? { label: req.body.label } : {}),
        ...(req.body.group ? { group: req.body.group } : {}),
        updatedById: req.auth!.userId,
      },
      create: {
        key,
        value: req.body.value,
        label: req.body.label ?? key,
        group: req.body.group ?? 'general',
        updatedById: req.auth!.userId,
      },
    });

    await audit({
      actorId: req.auth!.userId,
      action: 'SETTING_CHANGED',
      targetType: 'setting',
      targetId: key,
      metadata: { from: before?.value ?? null, to: req.body.value },
      ipAddress: clientIp(req),
    });

    res.json({ setting });
  },
);

/* ───────── سجل العمليات الإدارية ───────── */

adminRouter.get('/audit-log', validate(listAuditQuery, 'query'), async (_req, res) => {
  res.json(await service.listAuditLog(validated(res, 'query')));
});
