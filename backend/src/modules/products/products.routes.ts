import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { param } from '../../lib/http.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { validate, validated } from '../../middleware/validate.js';
import { badRequest } from '../../lib/errors.js';
import { assertShopApproved, getOwnedShopOrThrow } from '../shops/shops.service.js';
import {
  addProductSchema,
  barcodeParam,
  myProductsQuery,
  updateListingSchema,
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

/** مسح/إدخال باركود: NEW | AVAILABLE_TO_ADD | ALREADY_LISTED */
productsRouter.get('/barcode/:code', async (req, res) => {
  const shop = await getOwnedShopOrThrow(req.auth!.userId);
  const parsed = barcodeParam.safeParse({ code: param(req, 'code') });
  if (!parsed.success) {
    throw badRequest('كود بار غير صالح', {
      fields: [{ field: 'barcode', message: parsed.error.issues[0]?.message ?? 'كود بار غير صالح' }],
    });
  }
  res.json(await service.lookupBarcode(shop.id, parsed.data.code));
});

productsRouter.post('/', writeLimiter, validate(addProductSchema), async (req, res) => {
  const shop = await getOwnedShopOrThrow(req.auth!.userId);
  assertShopApproved(shop.status);
  const result = await service.addProductToShop(shop.id, req.body);
  res.status(201).json(result);
});

productsRouter.patch(
  '/:productId',
  writeLimiter,
  validate(updateListingSchema),
  async (req, res) => {
    const shop = await getOwnedShopOrThrow(req.auth!.userId);
    res.json({
      product: await service.updateListing(shop.id, param(req, 'productId'), req.body),
    });
  },
);

productsRouter.delete('/:productId', writeLimiter, async (req, res) => {
  const shop = await getOwnedShopOrThrow(req.auth!.userId);
  await service.deleteListing(shop.id, param(req, 'productId'));
  res.json({ ok: true });
});
