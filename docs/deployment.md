# النشر — قُفّة

المشروع خمسة أجزاء تُنشر منفصلة: **خادم API** + **أربع واجهات ثابتة**، وقاعدة بيانات PostgreSQL مُدارة.

---

## 0) الحالة الفعلية لهذا المشروع

| العنصر | الحالة |
|---|---|
| قاعدة بيانات الإنتاج | ✅ **جاهزة** — مشروع Supabase باسم `qoffa` (منطقة `eu-west-3`) |
| المخطط | ✅ مُطبَّق ومُتحقَّق منه: 18 جدولًا · 13 enum · 197 عمودًا · 64 فهرسًا · 32 مفتاحًا أجنبيًا |
| حساب مالك المنصة | ✅ مُنشأ بدور `SUPER_ADMIN` مع إجبار تغيير كلمة المرور |
| التصنيفات وإعدادات المنصة | ✅ 9 تصنيفات · 6 إعدادات |
| بيانات تجريبية | ❌ غير موجودة عمدًا — الإنتاج يبدأ نظيفًا |
| خادم الـAPI | ⏳ يحتاج استضافة (Render/Railway) + `DATABASE_URL` |
| الواجهات الأربع | ⏳ تُنشر بعد توفّر عنوان الـAPI |

**الخطوة الناقصة الوحيدة لتشغيل الخادم:** رابط الاتصال بقاعدة البيانات.
من لوحة Supabase → مشروع `qoffa` → **Connect** → **ORM / Prisma**:
- استعمل رابط **Transaction pooler** (منفذ 6543) كـ`DATABASE_URL`.
- إن لم تكن تعرف كلمة المرور: **Settings → Database → Reset database password**.

---

## 1) قاعدة البيانات

أي PostgreSQL 14+ مُدار: Neon · Supabase · Railway · RDS · VPS.

```bash
# قبل تشغيل النسخة الجديدة من الخادم
DATABASE_URL="postgresql://…" npx prisma migrate deploy --schema backend/prisma/schema.prisma
```

> في بيئة تمنع تنزيل محرّك Prisma استعمل البديل:
> `DATABASE_URL="…" node backend/scripts/migrate-apply.mjs`
> يطبّق نفس ملفات الهجرة ويسجّلها بنفس صيغة Prisma.

بعد النشر تحقّق من عدم وجود انحراف:

```bash
DATABASE_URL="…" npm run db:verify -w backend
```

إنشاء حساب مالك المنصة مرة واحدة (اقرأ قسم SUPER_ADMIN في README):

```bash
npm run db:seed:owner -w backend
```

**لا تشغّل `db:seed` في الإنتاج** — يرفض العمل عندما `NODE_ENV=production`.

---

## 2) خادم API

يحتاج **عملية طويلة الأمد** لأن مؤقّت مطابقة الموصّلين يعمل داخل الخادم.
لذلك Render / Railway / Fly.io / VPS مناسبة، و**Vercel Serverless غير مناسب للـbackend** كما هو.

المشروع يتضمّن ملفَّي نشر جاهزين:

- **`render.yaml`** — Blueprint لـRender: ارفع المستودع إلى GitHub ثم *New → Blueprint*.
  يطبّق الهجرات قبل كل نشر، ويولّد `JWT_SECRET` تلقائيًا، ويترك الأسرار للضبط اليدوي.
- **`Dockerfile`** — صورة عامة تعمل على Railway / Fly.io / أي VPS يدعم Docker.

```bash
npm install
npm run build -w backend
node backend/dist/index.js
```

متغيرات البيئة المطلوبة في الإنتاج:

```
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://…
JWT_SECRET=<openssl rand -base64 48>
CORS_ORIGINS=https://app.example.com,https://shop.example.com,https://driver.example.com,https://admin.example.com
PLATFORM_OWNER_EMAIL=…
PLATFORM_OWNER_PHONE=…
```

نقطة الفحص الصحي: `GET /health` → `{"ok":true,...}`

### إن استُعمل Vercel للـbackend

يحتاج تحويل نقاط النهاية إلى Serverless Functions وإخراج مؤقّت المطابقة إلى Cron خارجي يستدعي دورة المطابقة.
هذا تغيير معماري **لم يُنفَّذ في هذه النسخة**.

---

## 3) الواجهات الأربع

كل واجهة موقع ثابت مستقل. على Vercel: مشروع لكل مجلد.

| الإعداد | القيمة |
|---|---|
| Root Directory | `frontend-customer` (أو `-shop` / `-driver` / `-admin`) |
| Install Command | `npm install` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Environment | `VITE_API_URL=https://api.example.com/api` |

`vercel.json` جاهز داخل كل مجلد واجهة ويتضمّن إعادة توجيه SPA (كل المسارات → `index.html`)،
وهو ضروري لأن التطبيقات تستعمل توجيهًا من جهة العميل.

### قائمة تحقّق بعد النشر

- [ ] `GET /health` يستجيب.
- [ ] الصفحة الرئيسية للزبون تعرض المحلات (لا 404 ولا CORS).
- [ ] تسجيل الدخول يعمل في الواجهات الأربع.
- [ ] `CORS_ORIGINS` يحتوي نطاقات الواجهات الأربعة بالضبط (بدون `/` في النهاية).
- [ ] طلب تجريبي كامل: زبون → محل → موصّل → تسليم.
- [ ] لوحة الإدارة تعرض الإحصائيات وسجل العمليات.
- [ ] لا أخطاء في Console المتصفح.
- [ ] `manifest.webmanifest` و`sw.js` يُخدَمان على الواجهات الثلاث (PWA).

---

## 4) ملاحظات تشغيلية

- **الرموز**: JWT في `Authorization` (لا cookies)، فلا حاجة لإعدادات `SameSite`، وCORS البسيط يكفي.
- **HTTPS مطلوب** لتشغيل تحديد الموقع (Geolocation) وتثبيت PWA.
- **`trust proxy`** مضبوط في الخادم ليعمل تحديد المعدّل خلف موازن تحميل.
- **النسخ الاحتياطي**: فعّل نسخًا يوميًا لقاعدة البيانات — كل الطلبات والمحافظ فيها.

## مفتاح JWT بدون نسخ أي سر يدويًا

الأولوية لمتغير البيئة `JWT_SECRET` (32 حرفًا على الأقل). إن غاب، يقرأ الخادم المفتاح من إعداد دور
قاعدة البيانات `qoffa.jwt_secret`، ويُولَّد داخل PostgreSQL نفسه فلا يظهر في أي ملف أو طرفية أو واجهة:

```sql
DO $$ BEGIN
  EXECUTE format('ALTER ROLE qoffa_app SET qoffa.jwt_secret = %L',
                 encode(extensions.gen_random_bytes(48), 'hex'));
END $$;
```

تدوير المفتاح = إعادة تنفيذ الأمر (يُسجَّل خروج جميع المستخدمين). ضبط `JWT_SECRET` في الاستضافة يتجاوز هذا الإعداد.

## TLS مع التحقق من الشهادة

`DATABASE_CA_CERT` يحمل شهادة CA العامة (Supabase Root 2021 CA) فيُفعَّل اتصال مشفّر مع تحقق كامل من
الشهادة واسم الخادم. لا تستعمل `sslmode=no-verify`.
