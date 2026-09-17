import { Router } from 'express';
import { param } from '../../lib/http.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import {
  acceptDeliveryOffer,
  declineDeliveryOffer,
  maybeRunDispatchTick,
} from '../../services/driverAssignment.js';
import { availabilitySchema, locationSchema } from './drivers.schema.js';
import * as service from './drivers.service.js';

export const driversRouter = Router();

driversRouter.use(requireAuth, requireRole('DRIVER'));

driversRouter.get('/me', async (req, res) => {
  res.json({ driver: await service.getDriverProfileOrThrow(req.auth!.userId) });
});

driversRouter.patch(
  '/me/availability',
  writeLimiter,
  validate(availabilitySchema),
  async (req, res) => {
    res.json({ driver: await service.setAvailability(req.auth!.userId, req.body) });
  },
);

driversRouter.patch('/me/location', validate(locationSchema), async (req, res) => {
  res.json({ location: await service.updateLocation(req.auth!.userId, req.body) });
});

driversRouter.get('/me/offers', async (req, res) => {
  const profile = await service.getDriverProfileOrThrow(req.auth!.userId);
  // يضمن تقدّم المطابقة حتى في بيئة بلا مؤقّت دائم
  await maybeRunDispatchTick();
  res.json({ items: await service.listPendingOffers(profile.id) });
});

driversRouter.get('/me/current', async (req, res) => {
  const profile = await service.getDriverProfileOrThrow(req.auth!.userId);
  res.json({ order: await service.getCurrentDelivery(profile.id) });
});

driversRouter.get('/me/stats', async (req, res) => {
  const profile = await service.getDriverProfileOrThrow(req.auth!.userId);
  res.json({ stats: await service.getDriverStats(profile.id) });
});

driversRouter.post('/offers/:orderId/accept', writeLimiter, async (req, res) => {
  const profile = await service.getDriverProfileOrThrow(req.auth!.userId);
  service.assertDriverApproved(profile.status);
  const delivery = await acceptDeliveryOffer(profile.id, param(req, 'orderId'));
  res.json({ ok: true, delivery });
});

driversRouter.post('/offers/:orderId/decline', writeLimiter, async (req, res) => {
  const profile = await service.getDriverProfileOrThrow(req.auth!.userId);
  await declineDeliveryOffer(profile.id, param(req, 'orderId'));
  res.json({ ok: true });
});
