-- مصدر صورة المنتج + آخر بحث خارجي. إضافة فقط: عمودان nullable ونوع enum جديد.
-- لا تغيير على أي بيانات قائمة، ولا على القيود (Product.barcode UNIQUE و ShopProduct(shopId, productId) UNIQUE كما هي).

CREATE TYPE "public"."ProductImageSource" AS ENUM ('OPEN_FOOD_FACTS', 'UPCITEMDB', 'SHOP_UPLOAD', 'ADMIN_UPLOAD');

ALTER TABLE "public"."Product" ADD COLUMN "imageSource" "public"."ProductImageSource";
ALTER TABLE "public"."Product" ADD COLUMN "externalLookupAt" TIMESTAMP(3);
