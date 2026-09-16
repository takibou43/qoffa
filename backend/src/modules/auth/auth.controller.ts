import type { Request, Response } from 'express';
import * as service from './auth.service.js';

export async function registerCustomer(req: Request, res: Response) {
  const result = await service.registerCustomer(req.body);
  res.status(201).json(result);
}

export async function registerShop(req: Request, res: Response) {
  const result = await service.registerShopOwner(req.body);
  res.status(201).json(result);
}

export async function registerDriver(req: Request, res: Response) {
  const result = await service.registerDriver(req.body);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response) {
  const result = await service.login(req.body);
  res.json(result);
}

export async function me(req: Request, res: Response) {
  const user = await service.getMe(req.auth!.userId);
  res.json({ user });
}

export async function changePassword(req: Request, res: Response) {
  await service.changePassword(
    req.auth!.userId,
    req.body.currentPassword,
    req.body.newPassword,
  );
  res.json({ ok: true, message: 'تم تغيير كلمة المرور' });
}
