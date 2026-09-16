import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './auth.controller.js';
import {
  changePasswordSchema,
  loginSchema,
  registerCustomerSchema,
  registerDriverSchema,
  registerShopSchema,
} from './auth.schema.js';

export const authRouter = Router();

// ملاحظة أمنية: لا يوجد مسار عام لإنشاء ADMIN أو SUPER_ADMIN.
authRouter.post(
  '/register/customer',
  authLimiter,
  validate(registerCustomerSchema),
  controller.registerCustomer,
);
authRouter.post(
  '/register/shop',
  authLimiter,
  validate(registerShopSchema),
  controller.registerShop,
);
authRouter.post(
  '/register/driver',
  authLimiter,
  validate(registerDriverSchema),
  controller.registerDriver,
);

authRouter.post('/login', authLimiter, validate(loginSchema), controller.login);

authRouter.get('/me', requireAuth, controller.me);
authRouter.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  controller.changePassword,
);
