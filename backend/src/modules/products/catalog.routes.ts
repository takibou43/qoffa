import { Router } from 'express';
import { param } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
import { barcodeParam } from './products.schema.js';
import * as service from './products.service.js';

/** كتالوج عام (بلا تسجيل دخول): المنتج العالمي + سعر وتوفر كل محل يعرضه */
export const catalogRouter = Router();

catalogRouter.get('/barcode/:code', async (req, res) => {
  const parsed = barcodeParam.safeParse({ code: param(req, 'code') });
  if (!parsed.success) {
    throw badRequest('كود بار غير صالح', {
      fields: [{ field: 'barcode', message: parsed.error.issues[0]?.message ?? 'كود بار غير صالح' }],
    });
  }
  res.json(await service.getCatalogByBarcode(parsed.data.code));
});
