-- Stock reservation on order creation + idempotent order submission.
-- Additive only: new Order/OrderItem columns, one unique index, one CHECK constraint.

ALTER TABLE "public"."Order" ADD COLUMN "stockReserved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."Order" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "public"."OrderItem" ADD COLUMN "reservedQty" INTEGER NOT NULL DEFAULT 0;

-- NULLs are distinct in PostgreSQL, so legacy orders without a key never collide.
CREATE UNIQUE INDEX "Order_customerId_clientRequestId_key" ON "public"."Order"("customerId", "clientRequestId");

-- Last line of defence: stock can never go negative (NULL = untracked stock).
ALTER TABLE "public"."ShopProduct" ADD CONSTRAINT "ShopProduct_stock_nonnegative" CHECK ("stock" IS NULL OR "stock" >= 0);
