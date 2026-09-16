import { Router } from 'express';
import { notFound } from '../../lib/errors.js';
import { param } from '../../lib/http.js';
import { prisma } from '../../lib/prisma.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { addressSchema, updateAddressSchema } from './addresses.schema.js';

export const addressesRouter = Router();

addressesRouter.use(requireAuth, requireRole('CUSTOMER'));

const addressSelect = {
  id: true,
  label: true,
  addressLine: true,
  city: true,
  latitude: true,
  longitude: true,
  notes: true,
  createdAt: true,
} as const;

/** يضمن أن العنوان يخص المستخدم الحالي */
async function ownedAddress(userId: string, addressId: string) {
  const address = await prisma.address.findFirst({
    where: { id: addressId, userId },
    select: { id: true },
  });
  if (!address) throw notFound('العنوان غير موجود');
  return address;
}

addressesRouter.get('/', async (req, res) => {
  const userId = req.auth!.userId;
  const [items, profile] = await Promise.all([
    prisma.address.findMany({
      where: { userId },
      select: addressSelect,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customerProfile.findUnique({
      where: { userId },
      select: { defaultAddressId: true },
    }),
  ]);
  res.json({ items, defaultAddressId: profile?.defaultAddressId ?? null });
});

addressesRouter.post('/', writeLimiter, validate(addressSchema), async (req, res) => {
  const userId = req.auth!.userId;
  const { setDefault, ...data } = req.body;

  const address = await prisma.address.create({
    data: { ...data, userId },
    select: addressSelect,
  });

  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
    select: { defaultAddressId: true },
  });
  // أول عنوان يصبح الافتراضي تلقائيًا
  if (setDefault || !profile?.defaultAddressId) {
    await prisma.customerProfile.update({
      where: { userId },
      data: { defaultAddressId: address.id },
    });
  }

  res.status(201).json({ address });
});

addressesRouter.patch(
  '/:addressId',
  writeLimiter,
  validate(updateAddressSchema),
  async (req, res) => {
    const userId = req.auth!.userId;
    const addressId = param(req, 'addressId');
    await ownedAddress(userId, addressId);

    const { setDefault, ...data } = req.body;
    const address = await prisma.address.update({
      where: { id: addressId },
      data,
      select: addressSelect,
    });
    if (setDefault) {
      await prisma.customerProfile.update({
        where: { userId },
        data: { defaultAddressId: addressId },
      });
    }
    res.json({ address });
  },
);

addressesRouter.delete('/:addressId', writeLimiter, async (req, res) => {
  const userId = req.auth!.userId;
  const addressId = param(req, 'addressId');
  await ownedAddress(userId, addressId);
  // العلاقة مع الطلبات SetNull — الطلبات تحتفظ بلقطة العنوان
  await prisma.address.delete({ where: { id: addressId } });
  res.json({ ok: true });
});
