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

الأولوية لمتغير البيئة `JWT_SECRET` (32 حرفًا على الأقل). إن غاب، يقرأ الخادم المفتاح من الجدول الخاص
`qoffa_private.app_secret`، وتُولَّد قيمته داخل PostgreSQL نفسه فلا تظهر في أي ملف أو طرفية أو واجهة.
المخطط `qoffa_private` خارج جداول التطبيق الـ18، غير مكشوف لواجهات Supabase العامة، وصلاحية `qoffa_app` عليه قراءة فقط.

```sql
CREATE SCHEMA IF NOT EXISTS qoffa_private;
REVOKE ALL ON SCHEMA qoffa_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS qoffa_private.app_secret (
  key text PRIMARY KEY, value text NOT NULL CHECK (length(value) >= 32),
  created_at timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON qoffa_private.app_secret FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA qoffa_private TO qoffa_app;
GRANT SELECT ON qoffa_private.app_secret TO qoffa_app;
INSERT INTO qoffa_private.app_secret (key, value)
SELECT 'jwt_secret', encode(extensions.gen_random_bytes(48), 'hex') ON CONFLICT (key) DO NOTHING;
```

تدوير المفتاح: `UPDATE qoffa_private.app_secret SET value = encode(extensions.gen_random_bytes(48), 'hex') WHERE key = 'jwt_secret';`
ثم إعادة النشر (يُسجَّل خروج جميع المستخدمين). ضبط `JWT_SECRET` في الاستضافة يتجاوز هذا الجدول.

## TLS مع التحقق من الشهادة

`DATABASE_CA_CERT` يحمل شهادة CA العامة (Supabase Root 2021 CA) فيُفعَّل اتصال مشفّر مع تحقق كامل من
الشهادة واسم الخادم. لا تستعمل `sslmode=no-verify`.

## حفظ كلمة مرور قاعدة البيانات وحدها

يمكن أن يحمل `DATABASE_URL` كلمة المرور وحدها (دون `postgresql://`) إذا ضُبطت أجزاء الاتصال غير السرية
بأسماء libpq القياسية: `PGHOST` و`PGPORT` و`PGUSER` و`PGDATABASE`. هكذا يبقى السر الوحيد في لوحة الاستضافة
هو كلمة المرور، ولا يلزم ترميز رموزها الخاصة. رسائل الخطأ تصف شكل القيمة فقط ولا تطبعها أبدًا.

## صور المنتجات (Supabase Storage)

الصورة مرتبطة بالمنتج العالمي `Product.imageUrl` (لا بـ`ShopProduct`): كل المحلات التي تعرض نفس الباركود
تُظهر نفس الصورة، والسعر/الكمية/التوفر تبقى خاصة بكل محل. الملف نفسه لا يُخزَّن في PostgreSQL؛
يُرفع إلى **Supabase Storage** في نفس مشروع `qoffa` ويُحفظ رابطه العام فقط. لا package جديد (REST عبر `fetch`).

| العنصر | القيمة |
|---|---|
| الدلو | `product-images` — عام للقراءة، حد 2MB، أنواع `image/jpeg,image/png,image/webp` |
| الكتابة | من الخادم فقط بمفتاح Supabase **سري** (`sb_secret_…` أو `service_role`) |
| الإعداد | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` في الاستضافة، **أو** في `qoffa_private.app_secret` بالمفتاحين `supabase_url` و`supabase_secret_key` (نفس نمط مفتاح JWT) |
| بلا إعداد | مسارات الرفع تعيد `503 STORAGE_UNAVAILABLE` بوضوح، وكل شيء آخر يعمل (المنتجات تظهر ببديل بلا صورة) |

إنشاء الدلو (مرة واحدة):

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', true, 2097152, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;
```

ضبط المفتاح دون لمس لوحة Vercel (من Supabase → SQL Editor؛ المفتاح من **Settings → API Keys → Secret keys**):

```sql
INSERT INTO qoffa_private.app_secret (key, value) VALUES
  ('supabase_url', 'https://jtblwrecajqttaurerxg.supabase.co'),
  ('supabase_secret_key', '<الصق المفتاح السري هنا>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

المسارات:

| المسار | من | ماذا |
|---|---|---|
| `PUT /api/products/:listingId/image` | المحل | أول صورة لمنتج بلا صورة، أو استبدال صورة منتج **خاص** بالمحل (بلا باركود ولا يعرضه غيره) |
| `DELETE /api/products/:listingId/image` | المحل | منتج خاص بالمحل فقط |
| `GET /api/admin/products` | الإدارة | الكتالوج العالمي (`?q=` و`?image=with|without`) |
| `PUT /api/admin/products/:productId/image` | الإدارة | إضافة/استبدال — يُسجَّل في سجل العمليات |
| `DELETE /api/admin/products/:productId/image` | الإدارة | حذف الصورة فقط (المنتج والعروض والطلبات تبقى) |

جسم الرفع = بايتات الصورة نفسها مع `Content-Type` الصحيح. الخادم يتحقق من التوقيع الحقيقي للملف (لا الاسم
ولا الترويسة وحدها)، ومن الأبعاد (64–4096 بكسل) والحجم (2MB). الواجهات تصغّر الصورة إلى 1024 بكسل WebP قبل
الرفع (عادة < 150KB). الاستبدال آمن: رفع الجديدة ← تحديث ذري مشروط للرابط ← حذف القديمة إن لم تعد مستعملة.

## جلب بيانات المنتج وصورته بالباركود (Open Food Facts ← UPCitemdb)

عند مسح باركود في لوحة المحل (`GET /api/products/barcode/:code`):

1. **قاعدة قُفّة أولًا.** منتج موجود وله صورة → يُعاد فورًا، **بلا أي استدعاء خارجي**.
2. منتج موجود **بلا صورة** → نبحث عن صورة فقط (مرة كل 7 أيام كحد أقصى لكل منتج، عبر `Product.externalLookupAt`)،
   ونضيفها بشرط ذري (`WHERE imageUrl IS NULL`) دون لمس الاسم أو أي سعر/مخزون.
3. باركود جديد → **Open Food Facts** (`world.openfoodfacts.org/api/v2/product/{barcode}`، بلا مفتاح، User-Agent مخصّص)
   ثم **UPCitemdb** (`/prod/trial/lookup` مجانًا، أو `/prod/v1/lookup` بمفتاح `UPCITEMDB_API_KEY`).
   إن وُجد: يُنشأ `Product` مرة واحدة (`INSERT … ON CONFLICT DO NOTHING` على `barcode`) وتُحفظ الصورة في Supabase Storage.
4. لا نتيجة → إدخال يدوي + رفع صورة.

| قاعدة | التطبيق |
|---|---|
| المصادر تُستعمل عند الحاجة فقط | البحث بالباركود للمحلات **المعتمدة** فقط؛ لا شيء عند عرض المنتجات |
| صحة النتيجة | يجب أن يطابق الباركود المُعاد الباركود المطلوب (نفس الـGTIN)؛ وإلا تُرفض |
| الباركود نص | الأصفار البادئة محفوظة؛ لا تحويل إلى رقم |
| البيانات المخزّنة | الاسم، العلامة، الحجم (كوحدة)، الصورة فقط — لا ردود JSON كاملة، ولا أسعار ولا كميات خارجية |
| الصورة | تُنزّل وتُحفظ في تخزين قُفّة (`imageSource` = `OPEN_FOOD_FACTS`/`UPCITEMDB`)؛ الزبون لا يعتمد على روابط خارجية |
| صورة OFF | صورة الواجهة (`front`) فقط ومن `images.openfoodfacts.org` فقط |
| SSRF | https:443 فقط، رفض أي IP داخلي بعد حل DNS (والاتصال بالعنوان المفحوص نفسه)، بلا تحويلات، مهلة، حد 2MB، نوع صورة فقط + فحص التوقيع والأبعاد |
| التعطّل الخارجي | timeout/شبكة/حد استعمال → لا يفشل شيء؛ رسالة «لم نجد بيانات تلقائية…» والإدخال اليدوي متاح |
| التكرار | طلب واحد جارٍ لكل باركود + ذاكرة مؤقتة للنتائج السلبية (30 دقيقة، أو دقيقتان عند الأخطاء) + حد 30 بحثًا/دقيقة لكل مستخدم |

متغيرات البيئة: `EXTERNAL_BARCODE_LOOKUP=on|off` (افتراضي `on`)، `UPCITEMDB_API_KEY` (اختياري، لا يُطبع أبدًا).
السجلات: `[barcode] lookup barcode=… source=QOFFA|OPEN_FOOD_FACTS|UPCITEMDB|MANUAL` فقط.
