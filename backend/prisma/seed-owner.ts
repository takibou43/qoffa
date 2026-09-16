/**
 * قُفّة — إنشاء/تأكيد حساب مالك المنصة (SUPER_ADMIN).
 *
 * آمن للتشغيل في الإنتاج ويمكن تكراره (idempotent):
 *  - إن لم يوجد مستخدم بالبريد PLATFORM_OWNER_EMAIL يُنشأ بدور SUPER_ADMIN.
 *  - إن كان موجودًا لا تُنشأ نسخة ثانية ولا تُغيَّر كلمة مروره.
 *  - كلمة المرور تُقرأ من PLATFORM_OWNER_PASSWORD، وإن لم تُحدَّد تُولَّد عشوائيًا
 *    وتُطبع مرة واحدة فقط مع إجبار تغييرها عند أول دخول.
 *
 * لا توجد أي كلمة مرور أو بريد مكتوب داخل الكود.
 */
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { env } from '../src/config/env.js';
import { hashPassword } from '../src/lib/password.js';

function generatePassword(): string {
  // 24 حرفًا من base64url — قوة عالية وسهل النسخ
  return randomBytes(18).toString('base64url');
}

export async function seedPlatformOwner(prisma: PrismaClient) {
  const email = env.platformOwnerEmail;

  if (!email) {
    console.log(
      '⚠ PLATFORM_OWNER_EMAIL غير محدد — تم تخطي إنشاء حساب مالك المنصة.\n' +
        '  حدّده في .env ثم شغّل: npm run db:seed:owner',
    );
    return null;
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, status: true, fullName: true },
  });

  if (existing) {
    // موجود مسبقًا: نضمن فقط أن الدور صحيح والحساب فعّال، دون لمس كلمة المرور
    if (existing.role !== 'SUPER_ADMIN' || existing.status !== 'ACTIVE') {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      console.log('✔ حساب مالك المنصة موجود — تم تصحيح الدور/الحالة إلى SUPER_ADMIN/ACTIVE.');
    } else {
      console.log('✔ حساب مالك المنصة موجود مسبقًا — لم يُنشأ حساب جديد.');
    }
    return existing.id;
  }

  const phone = env.PLATFORM_OWNER_PHONE?.trim();
  if (!phone) {
    throw new Error(
      'PLATFORM_OWNER_PHONE مطلوب لإنشاء حساب المالك (تسجيل الدخول يتم برقم الهاتف).',
    );
  }

  const provided = env.PLATFORM_OWNER_PASSWORD?.trim();
  const password = provided || generatePassword();
  const generated = !provided;

  const owner = await prisma.user.create({
    data: {
      email,
      phone,
      fullName: env.PLATFORM_OWNER_NAME?.trim() || 'مالك المنصة',
      passwordHash: await hashPassword(password),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      // إن وُلِّدت كلمة المرور آليًا نُجبر تغييرها عند أول دخول
      mustChangePassword: generated,
    },
    select: { id: true },
  });

  console.log('\n✔ تم إنشاء حساب مالك المنصة (SUPER_ADMIN).');
  console.log(`  رقم الدخول: ${phone}`);
  if (generated) {
    console.log('\n  ┌─────────────────────────────────────────────────────────┐');
    console.log('  │ كلمة مرور مؤقتة — تُعرض مرة واحدة فقط، احفظها الآن:     │');
    console.log('  └─────────────────────────────────────────────────────────┘');
    console.log(`\n      ${password}\n`);
    console.log('  سيُطلب تغييرها إجباريًا عند أول تسجيل دخول.\n');
  } else {
    console.log('  كلمة المرور: المُحدَّدة في PLATFORM_OWNER_PASSWORD.\n');
  }

  return owner.id;
}

// تشغيل مباشر: npm run db:seed:owner
const isDirectRun = process.argv[1]?.includes('seed-owner');
if (isDirectRun) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  seedPlatformOwner(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
