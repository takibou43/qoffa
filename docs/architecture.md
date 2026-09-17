# البنية المعمارية — قُفّة

## نظرة عامة

Monorepo بـ npm workspaces: خادم واحد (Express) + أربع واجهات React مستقلة، وقاعدة بيانات PostgreSQL واحدة.
كل منطق الأعمال والصلاحيات في الخادم؛ الواجهات لا تحمل أي قرار أمني.

```
frontend-customer ─┐
frontend-shop     ─┤
frontend-driver   ─┼──► Backend API (Express 5) ──► PostgreSQL (Prisma 7)
frontend-admin    ─┘
```

## طبقات الخادم

```
routes.ts            تركيب الموجّهات تحت /api
 └─ modules/<name>/
     ├─ *.routes.ts      المسارات + المصادقة + التحقق (بلا منطق أعمال)
     ├─ *.controller.ts  (عند اللزوم) تحويل الطلب إلى استدعاء خدمة
     ├─ *.service.ts     منطق الأعمال + فحوص الملكية
     └─ *.schema.ts      مخططات zod للمدخلات
 └─ services/            خدمات مشتركة عابرة للوحدات
     ├─ orderStateMachine.ts   المصدر الوحيد لانتقالات حالة الطلب
     ├─ driverAssignment.ts    عروض التوصيل والمطابقة
     ├─ wallet.ts              التسوية المالية
     ├─ notifications.ts       الإشعارات داخل التطبيق
     └─ audit.ts               سجل العمليات الإدارية
```

**قاعدة ثابتة:** لا يوجد في أي `routes.ts` تحديث مباشر لـ`order.status`. كل تغيير حالة يمر من `transitionOrder`.

## الأمان

| الطبقة | التطبيق |
|---|---|
| المصادقة | JWT في ترويسة `Authorization: Bearer` |
| صلاحية الدور | `requireRole(...)` — والدور يُقرأ من قاعدة البيانات في كل طلب لا من الرمز |
| حالة الحساب | الحساب المعلّق يُرفض فورًا حتى برمز صالح |
| الملكية | فحص في كل عملية: المحل يملك المنتج، الزبون يملك الطلب، الموصّل مُسند للطلب |
| المدخلات | zod على كل body/query |
| المعدّل | `express-rate-limit`: عام، مشدّد على المصادقة، ومتوسط على الكتابة |
| الترويسات | `helmet` |
| CORS | قائمة نطاقات مسموحة من `CORS_ORIGINS` |
| SQL | Prisma (استعلامات مُعامَلة) |
| الأسرار | متغيرات بيئة فقط؛ `.env` خارج Git |

## الأموال

- كل المبالغ `Int` بالدينار الجزائري. **لا floating point.**
- النِسَب بالنقاط الأساسية (bps): `1000 = 10%`.
- الأسعار تُقرأ من قاعدة البيانات عند إنشاء الطلب — أي `price`/`total` يرسله العميل **يُتجاهل**.
- لقطة السعر والاسم والوحدة تُحفظ في `OrderItem` وقت الطلب.

## الموقع الجغرافي

- تصفية أولية بصندوق إحاطة (يستفيد من index على `latitude, longitude`)، ثم مسافة Haversine دقيقة.
- كافٍ لحجم MVP دون PostGIS؛ يمكن الترقية لاحقًا دون تغيير الواجهات.
- موقع الموصّل يُحدَّث عند تفعيل التوفر أو أثناء طلب جارٍ فقط — لا تتبّع مستمر.

## قاعدة البيانات

18 جدولًا و13 enum. الجداول الأساسية:

`User` · `CustomerProfile` · `Address` · `Shop` · `Category` · `ShopProduct` · `DriverProfile` ·
`Order` · `OrderItem` · `OrderStatusEvent` · `Delivery` · `DeliveryOffer` · `Review` ·
`Wallet` · `WalletTransaction` · `Notification` · `AdminAuditLog` · `PlatformSetting`

فهارس على: `shopId`, `customerId`, `driverId`, `status`, `createdAt`, و`(latitude, longitude)`.

## الواجهات

كل واجهة مستقلة تمامًا (بناء ونشر منفصل) وتشترك في النمط نفسه:

```
src/
├─ lib/apiCore.ts   غلاف fetch: الرمز، الأخطاء العربية، 401 → إعادة للدخول
├─ lib/api.ts       نقاط النهاية الخاصة بهذا الدور
├─ lib/auth.tsx     سياق المصادقة
├─ lib/format.ts    الدينار، المسافة، تسميات الحالات، روابط tel:/خرائط
├─ components/ui.tsx  عناصر مشتركة + حالات التحميل والفراغ والأخطاء
└─ pages/
```

تسميات حالات الطلب في الواجهة **عرض فقط**؛ لا توجد آلة حالات ثانية في أي واجهة.
