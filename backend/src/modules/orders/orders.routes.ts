import { Router } from 'express';
import { param } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { validate, validated } from '../../middleware/validate.js';
import { assertDriverOrder, getDriverProfileOrThrow } from '../drivers/drivers.service.js';
import { offerToNextDriver } from '../../services/driverAssignment.js';
import { getOwnedShopOrThrow } from '../shops/shops.service.js';
import {
  cancelOrderSchema,
  createOrderSchema,
  failDeliverySchema,
  listOrdersQuery,
  rejectOrderSchema,
  type ListOrdersQuery,
} from './orders.schema.js';
import * as service from './orders.service.js';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

/* ───────────── الزبون ───────────── */

ordersRouter.post(
  '/',
  requireRole('CUSTOMER'),
  writeLimiter,
  validate(createOrderSchema),
  async (req, res) => {
    const order = await service.createOrder(req.auth!.userId, req.body);
    res.status(201).json({ order });
  },
);

ordersRouter.get(
  '/me',
  requireRole('CUSTOMER'),
  validate(listOrdersQuery, 'query'),
  async (req, res) => {
    const query = validated<ListOrdersQuery>(res, 'query');
    res.json(await service.listCustomerOrders(req.auth!.userId, query));
  },
);

ordersRouter.post(
  '/:orderId/cancel',
  requireRole('CUSTOMER'),
  writeLimiter,
  validate(cancelOrderSchema),
  async (req, res) => {
    const orderId = param(req, 'orderId');
    await service.assertCustomerOrder(orderId, req.auth!.userId);
    const result = await service.transitionOrder(orderId, 'CANCELLED', {
      actorType: 'CUSTOMER',
      actorId: req.auth!.userId,
      reason: req.body.reason,
    });
    res.json({ ok: true, ...result });
  },
);

/* ───────────── المحل ───────────── */

const shopOnly = [requireRole('SHOP_OWNER'), writeLimiter] as const;

ordersRouter.get(
  '/shop',
  requireRole('SHOP_OWNER'),
  validate(listOrdersQuery, 'query'),
  async (req, res) => {
    const shop = await getOwnedShopOrThrow(req.auth!.userId);
    const query = validated<ListOrdersQuery>(res, 'query');
    res.json(await service.listShopOrders(shop.id, query));
  },
);

/** خطوات المحل: قبول → بدء التحضير → جاهز */
const shopActions = [
  { path: 'accept', status: 'SHOP_ACCEPTED' },
  { path: 'prepare', status: 'PREPARING' },
  { path: 'ready', status: 'READY_FOR_PICKUP' },
] as const;

for (const action of shopActions) {
  ordersRouter.post(`/:orderId/${action.path}`, ...shopOnly, async (req, res) => {
    const orderId = param(req, 'orderId');
    await service.assertShopOrder(orderId, req.auth!.userId);
    const result = await service.transitionOrder(orderId, action.status, {
      actorType: 'SHOP',
      actorId: req.auth!.userId,
    });

    // بمجرد أن يصبح الطلب جاهزًا نبدأ البحث عن موصّل فورًا
    if (action.status === 'READY_FOR_PICKUP') {
      await offerToNextDriver(orderId).catch((err) =>
        console.error('[dispatch] فشل العرض الأول', orderId, err),
      );
    }

    res.json({ ok: true, ...result });
  });
}

/** إعادة محاولة البحث عن موصّل بعد NO_DRIVER */
ordersRouter.post('/:orderId/retry-dispatch', ...shopOnly, async (req, res) => {
  const orderId = param(req, 'orderId');
  await service.assertShopOrder(orderId, req.auth!.userId);
  const result = await service.transitionOrder(orderId, 'READY_FOR_PICKUP', {
    actorType: 'SHOP',
    actorId: req.auth!.userId,
    note: 'إعادة البحث عن موصّل',
  });
  await offerToNextDriver(orderId).catch(() => undefined);
  res.json({ ok: true, ...result });
});

ordersRouter.post(
  '/:orderId/reject',
  ...shopOnly,
  validate(rejectOrderSchema),
  async (req, res) => {
    const orderId = param(req, 'orderId');
    await service.assertShopOrder(orderId, req.auth!.userId);
    const result = await service.transitionOrder(orderId, 'REJECTED', {
      actorType: 'SHOP',
      actorId: req.auth!.userId,
      reason: req.body.reason,
    });
    res.json({ ok: true, ...result });
  },
);

/* ───────────── الموصّل ───────────── */

const driverActions = [
  { path: 'pickup', status: 'PICKED_UP' },
  { path: 'out-for-delivery', status: 'OUT_FOR_DELIVERY' },
  { path: 'deliver', status: 'DELIVERED' },
] as const;

for (const action of driverActions) {
  ordersRouter.post(
    `/:orderId/${action.path}`,
    requireRole('DRIVER'),
    writeLimiter,
    async (req, res) => {
      const orderId = param(req, 'orderId');
      const profile = await getDriverProfileOrThrow(req.auth!.userId);
      await assertDriverOrder(orderId, profile.id);
      const result = await service.transitionOrder(orderId, action.status, {
        actorType: 'DRIVER',
        actorId: req.auth!.userId,
      });
      res.json({ ok: true, ...result });
    },
  );
}

/** تعذّر التسليم */
ordersRouter.post(
  '/:orderId/fail-delivery',
  requireRole('DRIVER'),
  writeLimiter,
  validate(failDeliverySchema),
  async (req, res) => {
    const orderId = param(req, 'orderId');
    const profile = await getDriverProfileOrThrow(req.auth!.userId);
    await assertDriverOrder(orderId, profile.id);
    const result = await service.transitionOrder(orderId, 'FAILED_DELIVERY', {
      actorType: 'DRIVER',
      actorId: req.auth!.userId,
      reason: req.body.reason,
    });
    res.json({ ok: true, ...result });
  },
);

/** انسحاب الموصّل بعد القبول — يعود الطلب للبحث عن موصّل آخر */
ordersRouter.post('/:orderId/release', requireRole('DRIVER'), writeLimiter, async (req, res) => {
  const orderId = param(req, 'orderId');
  const profile = await getDriverProfileOrThrow(req.auth!.userId);
  await assertDriverOrder(orderId, profile.id);
  const result = await service.transitionOrder(orderId, 'READY_FOR_PICKUP', {
    actorType: 'DRIVER',
    actorId: req.auth!.userId,
    note: 'انسحب الموصّل',
  });
  await offerToNextDriver(orderId).catch(() => undefined);
  res.json({ ok: true, ...result });
});

/* ───────────── مشترك ───────────── */

ordersRouter.get('/:orderId', async (req, res) => {
  const order = await service.getOrderForUser(
    param(req, 'orderId'),
    req.auth!.userId,
    req.auth!.role,
  );
  res.json({ order });
});

ordersRouter.get('/:orderId/timeline', async (req, res) => {
  const orderId = param(req, 'orderId');
  // نفس فحص الصلاحية المستعمل لقراءة الطلب
  await service.getOrderForUser(orderId, req.auth!.userId, req.auth!.role);
  res.json({ items: await service.getOrderTimeline(orderId) });
});
