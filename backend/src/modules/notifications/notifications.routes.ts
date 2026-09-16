import { Router } from 'express';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { paginated, paginationSchema, type Pagination } from '../../lib/pagination.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate, validated } from '../../middleware/validate.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

const listQuery = paginationSchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

notificationsRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const query = validated<Pagination & { unreadOnly: boolean }>(res, 'query');
  const where = {
    userId: req.auth!.userId,
    ...(query.unreadOnly ? { isRead: false } : {}),
  };

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        orderId: true,
        isRead: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.auth!.userId, isRead: false } }),
  ]);

  res.json({ ...paginated(items, total, query), unreadCount });
});

notificationsRouter.post('/:notificationId/read', async (req, res) => {
  const id = param(req, 'notificationId');
  // المستخدم لا يستطيع تعليم إشعار غيره
  const updated = await prisma.notification.updateMany({
    where: { id, userId: req.auth!.userId },
    data: { isRead: true },
  });
  if (updated.count === 0) throw notFound('الإشعار غير موجود');
  res.json({ ok: true });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.auth!.userId, isRead: false },
    data: { isRead: true },
  });
  res.json({ ok: true, updated: result.count });
});
