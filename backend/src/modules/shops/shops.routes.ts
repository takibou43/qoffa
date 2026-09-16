import { Router } from 'express';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { numberQuery, param } from '../../lib/http.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { validate, validated } from '../../middleware/validate.js';
import * as productService from '../products/products.service.js';
import {
  nearbyShopsQuery,
  shopProductsQuery,
  toggleOpenSchema,
  updateMyShopSchema,
  type NearbyShopsQuery,
  type ShopProductsQuery,
} from './shops.schema.js';
import * as service from './shops.service.js';

export const shopsRouter = Router();

/* ───────── مسارات لوحة صاحب المحل (قبل /:shopId حتى لا تُلتقط كمعرّف) ───────── */

const shopOwnerOnly = [requireAuth, requireRole('SHOP_OWNER')] as const;

shopsRouter.get('/me', ...shopOwnerOnly, async (req, res) => {
  res.json({ shop: await service.getOwnedShopOrThrow(req.auth!.userId) });
});

shopsRouter.patch(
  '/me',
  ...shopOwnerOnly,
  writeLimiter,
  validate(updateMyShopSchema),
  async (req, res) => {
    res.json({ shop: await service.updateMyShop(req.auth!.userId, req.body) });
  },
);

shopsRouter.patch(
  '/me/open',
  ...shopOwnerOnly,
  writeLimiter,
  validate(toggleOpenSchema),
  async (req, res) => {
    res.json(await service.setShopOpen(req.auth!.userId, req.body.isOpen));
  },
);

shopsRouter.get('/me/stats', ...shopOwnerOnly, async (req, res) => {
  const shop = await service.getOwnedShopOrThrow(req.auth!.userId);
  res.json({ stats: await service.getShopStats(shop.id) });
});

/* ───────── مسارات عامة للزبون ───────── */

shopsRouter.get('/', optionalAuth, validate(nearbyShopsQuery, 'query'), async (_req, res) => {
  const query = validated<NearbyShopsQuery>(res, 'query');
  res.json(await service.listNearbyShops(query));
});

shopsRouter.get('/:shopId', optionalAuth, async (req, res) => {
  const shop = await service.getPublicShop(
    param(req, 'shopId'),
    numberQuery(req, 'lat'),
    numberQuery(req, 'lon'),
  );
  res.json({ shop });
});

shopsRouter.get(
  '/:shopId/products',
  optionalAuth,
  validate(shopProductsQuery, 'query'),
  async (req, res) => {
    // نتأكد أن المحل معتمد قبل عرض منتجاته
    const shopId = param(req, 'shopId');
    await service.getPublicShop(shopId);
    const query = validated<ShopProductsQuery>(res, 'query');
    res.json(await productService.listPublicShopProducts(shopId, query));
  },
);
