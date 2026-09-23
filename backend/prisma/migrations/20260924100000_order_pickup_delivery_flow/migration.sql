-- Pickup by QR scan + delivery confirmation (QR or PIN) + scan log.
-- Additive only. Existing orders get a random 4-digit PIN (volatile default is evaluated per row).

CREATE TYPE "public"."OrderScanStage" AS ENUM ('PICKUP', 'DELIVERY');
CREATE TYPE "public"."OrderScanMethod" AS ENUM ('QR', 'PIN');

ALTER TABLE "public"."Order" ADD COLUMN "deliveryPin" TEXT NOT NULL DEFAULT lpad(((floor((random() * (10000)::double precision)))::integer)::text, 4, '0'::text);
ALTER TABLE "public"."Order" ADD COLUMN "deliveryPinAttempts" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "public"."OrderScan" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stage" "public"."OrderScanStage" NOT NULL,
    "method" "public"."OrderScanMethod" NOT NULL DEFAULT 'QR',
    "driverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderScan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderScan_orderId_stage_key" ON "public"."OrderScan"("orderId", "stage");
CREATE INDEX "OrderScan_driverId_createdAt_idx" ON "public"."OrderScan"("driverId", "createdAt");

ALTER TABLE "public"."OrderScan" ADD CONSTRAINT "OrderScan_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OrderScan" ADD CONSTRAINT "OrderScan_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
