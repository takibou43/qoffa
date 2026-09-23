-- Fixed Qoffa share of the delivery fee, snapshotted on each order at creation.
-- Additive. Existing orders: delivered ones keep what was actually settled
-- (deliveryFee - driverEarning); the others get the new default (30, capped by the fee).

ALTER TABLE "public"."Order" ADD COLUMN "platformFee" INTEGER NOT NULL DEFAULT 0;

UPDATE "public"."Order"
SET "platformFee" = CASE
  WHEN "status" = 'DELIVERED' THEN GREATEST(0, "deliveryFee" - "driverEarning")
  ELSE LEAST(30, "deliveryFee")
END;
