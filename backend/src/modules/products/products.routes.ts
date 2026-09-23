import express, { Router } from 'express';
import { MAX_IMAGE_BYTES } from '../../lib/image.js';
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

/**
 * صورة المنتج العالمي من لوحة المحل. الجسم = بايتات الصورة نفسها (Content-Type: image/jpeg|png|webp)،
 * بلا multipart ولا package إضافي. الحد الأقصى للحجم يُفرض هنا قبل قراءة الملف كاملًا (413).
 * الصلاحيات في الخدمة: أول صورة فقط لمنتج مشترك، والاستبدال/الحذف لمنتج خاص بالمحل فقط.
 */
const rawImage = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });

productsRouter.put('/:productId/image', writeLimiter, rawImage, async (req, res) => {
  const shop = await getOwnedShopOrThrow(req.auth!.userId);
  assertShopApproved(shop.status);
  const product = await service.shopSetProductImage(
    shop.id,
    param(req, 'productId'),
    req.body,
    req.headers['content-type'],
  );
  res.json({ product });
});

productsRouter.delete('/:productId/image', writeLimiter, async (req, res) => {
  const shop = await getOwnedShopOrThrow(req.auth!.userId);
  const product = await service.shopRemoveProductImage(shop.id, param(req, 'productId'));
  res.json({ product });
});
