import { Router } from 'express';
import { validate, validated } from '../../middleware/validate.js';
import { listCategoriesQuery } from './categories.schema.js';
import { listCategories } from './categories.service.js';
import type { CategoryKind } from '../../generated/prisma/enums.js';

export const categoriesRouter = Router();

/** عام: قائمة التصنيفات */
categoriesRouter.get('/', validate(listCategoriesQuery, 'query'), async (_req, res) => {
  const { kind } = validated<{ kind?: CategoryKind }>(res, 'query');
  res.json({ items: await listCategories(kind) });
});
