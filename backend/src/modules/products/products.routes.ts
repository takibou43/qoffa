import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { param } from '../../lib/http.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { validate, validated } from '../../middleware/validate.js';
import { assertShopApproved, getOwnedShopOrThrow } from '../shops/shops.service.js';
import {
  createProductSchema,
  myProductsQuery,
  updateProductSchema,
  type MyProductsQuery,
} from './products.schema.js';
import * as service from './products.service.js';

export const productsRouter = Router();

// كل المسارات هنا تخص صاحب محل، والملكية تُتحقق في كل عملية
productsRouter.use(requireAuth, requireRole('SHOP_OWNER'));

productsRouter.get('/', validate(myProductsQuery, 'query'), async (req, res) => {
  const shop = await getOwnedShopOrThrow(req.auth!.userId);
  const query = validated<MyProductsQuery>(res, 'query');
  res.json(await service.listMyProducts(shop.id, query));
});

productsRouter.post('/', writeLimiter, validate(createProductSchema), async (req, res) => {
  const shop = await getOwnedShopOrThrow(req.auth!.userId);
  assertShopApproved(shop.status);
  res.status(201).json({ product: await service.createProduct(shop.id, req.body) });
});

productsRouter.patch(
  '/:productId',
  writeLimiter,
  validate(updateProductSchema),
  async (req, res) => {
    const shop = await getOwnedShopOrThrow(req.auth!.userId);
    res.json({
      product: await service.updateProduct(shop.id, param(req, 'productId'), req.body),
    });
  },
);

productsRouter.delete('/:productId', writeLimiter, async (req, res) => {
  const shop = await getOwnedShopOrThrow(req.auth!.userId);
  await service.deleteProduct(shop.id, param(req, 'productId'));
  res.json({ ok: true });
});
