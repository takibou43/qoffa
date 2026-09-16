import { Router } from 'express';
import { param } from '../../lib/http.js';
import { paginationSchema, type Pagination } from '../../lib/pagination.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { validate, validated } from '../../middleware/validate.js';
import { createReviewSchema } from './reviews.schema.js';
import * as service from './reviews.service.js';

export const reviewsRouter = Router();

/** عام: تقييمات محل */
reviewsRouter.get(
  '/shops/:shopId',
  validate(paginationSchema, 'query'),
  async (req, res) => {
    const pagination = validated<Pagination>(res, 'query');
    res.json(await service.listShopReviews(param(req, 'shopId'), pagination));
  },
);

/** الزبون يقيّم طلبه المُسلَّم */
reviewsRouter.post(
  '/orders/:orderId',
  requireAuth,
  requireRole('CUSTOMER'),
  writeLimiter,
  validate(createReviewSchema),
  async (req, res) => {
    const reviews = await service.reviewOrder(
      param(req, 'orderId'),
      req.auth!.userId,
      req.body,
    );
    res.status(201).json({ reviews });
  },
);
