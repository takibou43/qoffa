# قُفّة — Qoffa

> **من حانوتك إلى بابك.**

منصة جزائرية لتوصيل المواد الغذائية تربط **الزبون** بـ **حانوته القريب** عبر **موصّل**، مع **لوحة إدارة** للمنصة.
الدفع في هذه النسخة **نقدًا عند الاستلام** فقط، وكل المبالغ **أعداد صحيحة بالدينار الجزائري (DZD)**.

---

## المحتويات

- [البنية](#البنية)
- [المتطلبات](#المتطلبات)
- [التشغيل محليًا](#التشغيل-محليًا)
- [متغيرات البيئة](#متغيرات-البيئة)
- [قاعدة البيانات والهجرات](#قاعدة-البيانات-والهجرات)
- [حساب مالك المنصة](#حساب-مالك-المنصة-super_admin)
- [الأدوار والحسابات التجريبية](#الأدوار-والحسابات-التجريبية)
- [الاختبارات](#الاختبارات)
- [البناء](#البناء)
- [النشر](#النشر)
- [PWA](#pwa)
- [حدود هذه النسخة](#حدود-هذه-النسخة-mvp)

---

## البنية

```
qoffa/
├── backend/              Node 22 + Express 5 + TypeScript + Prisma 7 + PostgreSQL
│   ├── prisma/
│   │   ├── schema.prisma     18 جدولًا، 13 enum
│   │   ├── migrations/       هجرات SQL قابلة للنشر
│   │   ├── seed.ts           بيانات تجريبية (تطوير فقط)
│   │   └── seed-owner.ts     إنشاء مالك المنصة (آمن للإنتاج)
│   ├── scripts/
│   │   ├── migrate-apply.mjs   تطبيق الهجرات بدون محرّك Rust
│   │   └── verify-schema.ts    مقارنة قاعدة البيانات بالمخطط
│   ├── src/
│   │   ├── config/env.ts       متغيرات البيئة مُتحقَّق منها بـ zod
│   │   ├── lib/                geo, money, jwt, password, pagination…
│   │   ├── middleware/         auth, validate, rateLimit, error
│   │   ├── modules/            auth, shops, products, orders, drivers, reviews,
│   │   │                       notifications, addresses, categories, admin
│   │   └── services/           orderStateMachine, driverAssignment, wallet,
│   │                           notifications, audit
│   └── tests/                  148 اختبارًا (vitest + supertest)
│
├── frontend-customer/    تطبيق الزبون    (PWA · منفذ 5173)
├── frontend-shop/        لوحة المحل      (PWA · منفذ 5174)
├── frontend-driver/      تطبيق الموصّل   (PWA · منفذ 5175)
├── frontend-admin/       إدارة المنصة    (منفذ 5176)
└── docs/
```

كل الواجهات: **React 18 + Vite 6 + TypeScript + Tailwind 4**، عربية **RTL** بالكامل، Mobile‑First.

تفاصيل معمارية أعمق: [`docs/architecture.md`](docs/architecture.md) · تدفّق الطلب: [`docs/order-flow.md`](docs/order-flow.md)

---

## المتطلبات

| | |
|---|---|
| Node.js | **20 أو أحدث** (طُوّر واختُبر على 22) |
| npm | 10+ (workspaces) |
| PostgreSQL | **14 أو أحدث** (طُوّر على 16) |

---

## التشغيل محليًا

```bash
# 1) تثبيت الحزم لكل الـworkspaces
npm install

# 2) إعداد قاعدة البيانات
createdb qoffa            # أو: psql -c 'CREATE DATABASE qoffa;'

# 3) إعداد متغيرات البيئة
cp backend/.env.example backend/.env
#   ثم عدّل DATABASE_URL و JWT_SECRET على الأقل

# 4) توليد عميل Prisma + تطبيق الهجرات
npm run db:generate -w backend
npm run db:deploy   -w backend        # prisma migrate deploy

# 5) بيانات تجريبية (تطوير فقط)
npm run db:seed -w backend

# 6) التشغيل — كل أمر في نافذة طرفية
npm run dev:backend      # http://localhost:4000
npm run dev:customer     # http://localhost:5173
npm run dev:shop         # http://localhost:5174
npm run dev:driver       # http://localhost:5175
npm run dev:admin        # http://localhost:5176
```

الواجهات تمرّر `/api` إلى `http://localhost:4000` عبر proxy في وضع التطوير، فلا حاجة لضبط CORS محليًا.

> **ملاحظة:** في بيئة تمنع الوصول إلى `binaries.prisma.sh` استعمل `npm run db:apply -w backend`
> بدل `db:deploy` — يطبّق نفس ملفات `prisma/migrations/**/migration.sql` ويسجّلها في
> `_prisma_migrations` بنفس صيغة Prisma، فيبقى `prisma migrate status` متوافقًا.

---

## متغيرات البيئة

### Backend (`backend/.env`)

| المتغيّر | مطلوب | الوصف |
|---|---|---|
| `NODE_ENV` | — | `development` / `test` / `production` |
| `PORT` | — | منفذ الخادم (افتراضي 4000) |
| `DATABASE_URL` | **نعم** | رابط اتصال PostgreSQL |
| `JWT_SECRET` | **نعم** | 16 حرفًا على الأقل. في الإنتاج: `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | — | صلاحية الرمز (افتراضي `7d`) |
| `CORS_ORIGINS` | **في الإنتاج** | نطاقات الواجهات مفصولة بفاصلة |
| `PLATFORM_COMMISSION_BPS` | — | عمولة المنصة بالنقاط الأساسية (1000 = 10%) |
| `DEFAULT_DELIVERY_FEE` | — | رسوم التوصيل الافتراضية بالدينار |
| `DRIVER_FEE_SHARE_BPS` | — | نصيب الموصّل من رسوم التوصيل (8000 = 80%) |
| `SEARCH_RADIUS_KM` | — | نصف قطر البحث عن المحلات/الموصّلين |
| `DRIVER_OFFER_TIMEOUT_SECONDS` | — | مهلة قبول الموصّل للعرض |
| `MAX_DRIVER_OFFERS` | — | أقصى عدد عروض قبل `NO_DRIVER` |
| `PLATFORM_OWNER_EMAIL` | لإنشاء المالك | بريد مالك المنصة |
| `PLATFORM_OWNER_PHONE` | لإنشاء المالك | رقم الدخول لحساب المالك |
| `PLATFORM_OWNER_NAME` | — | الاسم المعروض |
| `PLATFORM_OWNER_PASSWORD` | — | إن تُرك فارغًا تُولَّد كلمة مرور عشوائية وتُطبع مرة واحدة |

### الواجهات (`frontend-*/.env`)

| المتغيّر | الوصف |
|---|---|
| `VITE_API_URL` | عنوان الـAPI الكامل في الإنتاج، مثل `https://api.example.com/api`. إن تُرك فارغًا تُستعمل `/api` نسبيًا |
| `VITE_API_PROXY` | وجهة الـproxy في التطوير/المعاينة المحلية (افتراضي `http://localhost:4000`) |

> **لا تضع أي سر في Git.** ملفات `.env` مستثناة في `.gitignore`، والمتاح فقط `.env.example`.

---

## قاعدة البيانات والهجرات

```bash
npm run db:generate -w backend   # توليد عميل Prisma
npm run db:migrate  -w backend   # إنشاء هجرة جديدة أثناء التطوير
npm run db:deploy   -w backend   # تطبيق الهجرات في الإنتاج
npm run db:apply    -w backend   # بديل لا يحتاج تنزيل محرّك Rust
npm run db:verify   -w backend   # التأكد أن القاعدة مطابقة للمخطط
npm run db:studio   -w backend   # واجهة Prisma Studio
```

المبالغ كلها `Int` بالدينار — **لا يوجد floating point في أي مبلغ**.

---

## حساب مالك المنصة (SUPER_ADMIN)

الدور `SUPER_ADMIN` **لا يُنشأ من أي واجهة أو API إطلاقًا**. الطريقة الوحيدة هي seed مقروء من متغيرات البيئة:

```bash
# 1) في backend/.env
PLATFORM_OWNER_EMAIL=owner@example.com
PLATFORM_OWNER_PHONE=05XXXXXXXX
PLATFORM_OWNER_NAME=مالك المنصة
PLATFORM_OWNER_PASSWORD=        # اتركه فارغًا ليولّد كلمة مرور قوية

# 2) التنفيذ (آمن وقابل للتكرار)
npm run db:seed:owner -w backend
```

- إن لم يوجد مستخدم بهذا البريد **يُنشأ** بدور `SUPER_ADMIN`.
- إن كان موجودًا **لا تُنشأ نسخة ثانية** ولا تُغيَّر كلمة مروره.
- إن تُركت `PLATFORM_OWNER_PASSWORD` فارغة تُولَّد كلمة مرور عشوائية **تُطبع مرة واحدة فقط** في الطرفية، مع إجبار تغييرها عند أول دخول.
- **لا يوجد أي بريد أو كلمة مرور مكتوبة داخل الكود.**

**قيود مفروضة في الخادم** (لا في الواجهة):

- لا مسار عام أو إداري يُنشئ `SUPER_ADMIN`؛ مسار إنشاء المدراء يفرض `role: 'ADMIN'` دائمًا.
- لا يمكن تعليق أو تعديل حساب مالك المنصة من أي حساب.
- إنشاء/إزالة المدراء، تغيير العمولات، تعديل المحافظ، وتغيير إعدادات المنصة: **لمالك المنصة وحده**.
- كل عملية إدارية حسّاسة تُكتب في `AdminAuditLog` من الخادم، والسجل للقراءة فقط.
- بريد المالك يظهر في لوحة الإدارة فقط، ولا يُعرض لأي زبون أو محل أو موصّل.

---

## الأدوار والحسابات التجريبية

| الدور | الصلاحية |
|---|---|
| `CUSTOMER` | يطلب، يتابع، يلغي ضمن القواعد، يقيّم |
| `SHOP_OWNER` | يدير محله ومنتجاته وطلباته فقط |
| `DRIVER` | يقبل عروض التوصيل المسندة إليه وينفّذها |
| `ADMIN` | إدارة المستخدمين والمحلات والموصّلين والطلبات والإحصائيات |
| `SUPER_ADMIN` | كل ما سبق + المدراء والعمولات والمحافظ وإعدادات المنصة |

بعد `npm run db:seed -w backend` (بيانات وهمية للتطوير فقط، كلمة المرور `Qoffa@1234` أو قيمة `SEED_DEMO_PASSWORD`):

| الدور | رقم الدخول |
|---|---|
| زبون | `0661110001` |
| صاحب محل | `0551110001` |
| موصّل | `0771110001` |
| مدير | `0555000000` |

> الـseed يرفض العمل عندما `NODE_ENV=production`.

---

## الاختبارات

```bash
npm test                      # كل اختبارات الـbackend (148)
npm run typecheck             # TypeScript في كل الـworkspaces
npm run lint                  # ESLint على المشروع كاملًا
```

اختبارات الـbackend تعمل على قاعدة بيانات **حقيقية** منفصلة:

```bash
cp backend/.env.test.example backend/.env.test   # ثم اضبط DATABASE_URL لقاعدة qoffa_test
createdb qoffa_test
npm test
```

التغطية تشمل: المصادقة والأدوار، ملكية المحل والمنتجات، إنشاء الطلب ومنع تزوير الأسعار،
آلة حالات الطلب كاملة، قواعد الإلغاء والرفض، `NO_DRIVER` و`FAILED_DELIVERY`،
**سباق قبول موصّلين لنفس الطلب**، التسوية المالية، وحماية `SUPER_ADMIN`.

---

## البناء

```bash
npm run build                 # backend + الواجهات الأربع
npm run build -w backend      # → backend/dist
npm run build -w frontend-customer   # → frontend-customer/dist
```

تشغيل الإنتاج للـbackend:

```bash
node backend/dist/index.js
```

---

## النشر

الخطوات الكاملة (Vercel / VPS / قاعدة بيانات مُدارة): [`docs/deployment.md`](docs/deployment.md)

الخلاصة:

1. قاعدة بيانات PostgreSQL مُدارة (Neon / Supabase / RDS / VPS).
2. Backend على خدمة تدعم خادمًا طويل الأمد (Render / Railway / Fly / VPS) — يحتاج مؤقّت مطابقة الموصّلين.
3. `npx prisma migrate deploy` قبل تشغيل النسخة الجديدة.
4. الواجهات الأربع كمواقع ثابتة (Vercel / Netlify / أي CDN) مع `VITE_API_URL`.
5. `CORS_ORIGINS` في الـbackend = نطاقات الواجهات الأربعة.

---

## PWA

`frontend-customer` و`frontend-shop` و`frontend-driver` قابلة للتثبيت (manifest + أيقونات + service worker + صفحة offline).

قواعد أمنية مطبَّقة في الـservice worker:

- **لا يُخزَّن أي رد من `/api` في الكاش** — بيانات الطلبات والحسابات حسّاسة.
- لا يتدخّل في طلبات `POST`/`PATCH`/`DELETE` إطلاقًا.
- **لا إنشاء أو تعديل طلبات دون اتصال**؛ عند انقطاع الشبكة تظهر صفحة `offline.html`.
- الكاش مخصّص لملفات الواجهة الثابتة فقط.

لوحة الإدارة ليست PWA عمدًا (أداة مكتبية، ولا داعي لتخزينها على الأجهزة).

---

## حدود هذه النسخة (MVP)

خارج النطاق حاليًا، والبنية تسمح بإضافتها لاحقًا دون إعادة بناء:

- الدفع الإلكتروني (الدفع نقدًا عند الاستلام فقط؛ `Wallet` و`WalletTransaction` موجودان لحساب العمولات والمستحقات فقط).
- Push Notifications (الإشعارات داخل التطبيق فقط).
- نظام خرائط خاص أو تتبّع GPS مستمر (روابط خرائط خارجية + موقع يُحدَّث عند تفعيل التوفر).
- محادثة داخلية (الاتصال عبر `tel:`).
- رفع صور المحلات (صور **المنتجات** مُنفَّذة — انظر «صور المنتجات» في `docs/deployment.md`).
- تعدد اللغات (العربية فقط الآن؛ النصوص مجمّعة ويمكن استخراجها لاحقًا).
- بحث جغرافي بـPostGIS (يُستعمل صندوق إحاطة + Haversine، كافٍ لحجم MVP).
