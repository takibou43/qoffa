-- منتج عالمي بالباركود (Product) + عرض المنتج داخل المحل (ShopProduct: سعر/كمية/توفر).
-- الترحيل لا يفقد أي بيانات: كل صف ShopProduct قائم يُنسخ إلى Product بنفس المعرّف ثم يُربط به،
-- ومعرّفات ShopProduct لا تتغير أبدًا (فتبقى OrderItem.productId والطلبات القديمة سليمة).
-- لا توجد باركودات سابقة في النظام، فلا يمكن أن توجد تكرارات قبل الترحيل.

-- 1) الجدول العالمي
CREATE TABLE "public"."Product" (
    "id" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'قطعة',
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- 2) نسخ بيانات المنتجات الحالية (منتج عالمي لكل صف قائم، بدون باركود)
INSERT INTO "public"."Product" ("id", "name", "description", "imageUrl", "unit", "categoryId", "createdAt", "updatedAt")
SELECT "id", "name", "description", "imageUrl", "unit", "categoryId", "createdAt", "updatedAt"
FROM "public"."ShopProduct";

-- 3) ربط كل عرض بمنتجه العالمي + الكمية الخاصة بالمحل
ALTER TABLE "public"."ShopProduct" ADD COLUMN "productId" TEXT;
ALTER TABLE "public"."ShopProduct" ADD COLUMN "stock" INTEGER;
UPDATE "public"."ShopProduct" SET "productId" = "id";

-- حارس أمان: يفشل الترحيل بالكامل (وتُلغى المعاملة) إن لم تتطابق الأعداد
DO $$
BEGIN
  IF (SELECT count(*) FROM "public"."Product") <> (SELECT count(*) FROM "public"."ShopProduct")
     OR EXISTS (SELECT 1 FROM "public"."ShopProduct" WHERE "productId" IS NULL) THEN
    RAISE EXCEPTION 'global_products migration: count mismatch, aborting to protect data';
  END IF;
END $$;

ALTER TABLE "public"."ShopProduct" ALTER COLUMN "productId" SET NOT NULL;

-- 4) إزالة الحقول التي انتقلت إلى Product (بياناتها نُسخت أعلاه)
DROP INDEX "public"."ShopProduct_shopId_categoryId_idx";
DROP INDEX "public"."ShopProduct_name_idx";
ALTER TABLE "public"."ShopProduct" DROP CONSTRAINT "ShopProduct_categoryId_fkey";
ALTER TABLE "public"."ShopProduct" DROP COLUMN "categoryId";
ALTER TABLE "public"."ShopProduct" DROP COLUMN "name";
ALTER TABLE "public"."ShopProduct" DROP COLUMN "description";
ALTER TABLE "public"."ShopProduct" DROP COLUMN "imageUrl";
ALTER TABLE "public"."ShopProduct" DROP COLUMN "unit";

-- 5) القيود: باركود فريد عالميًا، وعرض واحد لكل (محل، منتج)
CREATE UNIQUE INDEX "Product_barcode_key" ON "public"."Product"("barcode");
CREATE INDEX "Product_name_idx" ON "public"."Product"("name");
CREATE INDEX "Product_categoryId_idx" ON "public"."Product"("categoryId");
CREATE UNIQUE INDEX "ShopProduct_shopId_productId_key" ON "public"."ShopProduct"("shopId", "productId");
CREATE INDEX "ShopProduct_productId_idx" ON "public"."ShopProduct"("productId");

ALTER TABLE "public"."Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ShopProduct" ADD CONSTRAINT "ShopProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
