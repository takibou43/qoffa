-- Order QR verification: random opaque tokens (pickup: shop+driver, delivery: customer only).
-- Additive only. Existing orders get fresh random tokens (volatile default is evaluated per row).

ALTER TABLE "public"."Order" ADD COLUMN "pickupToken" TEXT NOT NULL DEFAULT replace(((gen_random_uuid())::text || (gen_random_uuid())::text), '-'::text, ''::text);
ALTER TABLE "public"."Order" ADD COLUMN "deliveryToken" TEXT NOT NULL DEFAULT replace(((gen_random_uuid())::text || (gen_random_uuid())::text), '-'::text, ''::text);
ALTER TABLE "public"."Order" ADD COLUMN "pickupVerifiedAt" TIMESTAMP(3);
ALTER TABLE "public"."Order" ADD COLUMN "deliveryVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_pickupToken_key" ON "public"."Order"("pickupToken");
CREATE UNIQUE INDEX "Order_deliveryToken_key" ON "public"."Order"("deliveryToken");
