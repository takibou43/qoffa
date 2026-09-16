-- قُفّة — الهجرة الأولى (init)

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('CUSTOMER', 'SHOP_OWNER', 'DRIVER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."OrderStatus" AS ENUM ('PENDING', 'SHOP_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DRIVER_ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'REJECTED', 'CANCELLED', 'NO_DRIVER', 'FAILED_DELIVERY');

-- CreateEnum
CREATE TYPE "public"."PaymentMethod" AS ENUM ('CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "public"."ActorType" AS ENUM ('CUSTOMER', 'SHOP', 'DRIVER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "public"."AdminAction" AS ENUM ('USER_SUSPENDED', 'USER_REACTIVATED', 'USER_ROLE_CHANGED', 'ADMIN_CREATED', 'ADMIN_REMOVED', 'SHOP_APPROVED', 'SHOP_REJECTED', 'SHOP_SUSPENDED', 'SHOP_REACTIVATED', 'SHOP_COMMISSION_CHANGED', 'DRIVER_APPROVED', 'DRIVER_REJECTED', 'DRIVER_SUSPENDED', 'DRIVER_REACTIVATED', 'ORDER_FORCE_STATUS', 'ORDER_REASSIGN_DRIVER', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED', 'WALLET_ADJUSTED', 'WALLET_PAYOUT', 'SETTING_CHANGED');

-- CreateEnum
CREATE TYPE "public"."DeliveryOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."CategoryKind" AS ENUM ('SHOP', 'PRODUCT');

-- CreateEnum
CREATE TYPE "public"."ReviewTargetType" AS ENUM ('SHOP', 'DRIVER');

-- CreateEnum
CREATE TYPE "public"."WalletOwnerType" AS ENUM ('SHOP', 'DRIVER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "public"."WalletTransactionType" AS ENUM ('ORDER_EARNING', 'PLATFORM_COMMISSION', 'DELIVERY_EARNING', 'PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('ORDER_CREATED', 'ORDER_ACCEPTED', 'ORDER_REJECTED', 'ORDER_PREPARING', 'ORDER_READY', 'DRIVER_ASSIGNED', 'ORDER_PICKED_UP', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'NO_DRIVER_FOUND', 'NEW_DELIVERY_OFFER', 'ACCOUNT_APPROVED', 'ACCOUNT_REJECTED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultAddressId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Address" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'المنزل',
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Shop" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "phone" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "status" "public"."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "openingTime" TEXT NOT NULL DEFAULT '08:00',
    "closingTime" TEXT NOT NULL DEFAULT '22:00',
    "deliveryFee" INTEGER NOT NULL DEFAULT 150,
    "commissionBps" INTEGER NOT NULL DEFAULT 1000,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "public"."CategoryKind" NOT NULL DEFAULT 'PRODUCT',
    "iconKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ShopProduct" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "price" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'قطعة',
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DriverProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "public"."ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "vehicleType" TEXT NOT NULL DEFAULT 'دراجة نارية',
    "plateNumber" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "currentOrderId" TEXT,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Order" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "public"."OrderStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal" INTEGER NOT NULL,
    "deliveryFee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "commissionAmount" INTEGER NOT NULL DEFAULT 0,
    "driverEarning" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" "public"."PaymentMethod" NOT NULL DEFAULT 'CASH_ON_DELIVERY',
    "customerNote" TEXT,
    "addressId" TEXT,
    "deliveryAddressLine" TEXT NOT NULL,
    "deliveryCity" TEXT NOT NULL,
    "deliveryLatitude" DOUBLE PRECISION NOT NULL,
    "deliveryLongitude" DOUBLE PRECISION NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "distanceMeters" INTEGER,
    "rejectionReason" TEXT,
    "cancelReason" TEXT,
    "cancelledBy" "public"."ActorType",
    "offerAttempts" INTEGER NOT NULL DEFAULT 0,
    "acceptedAt" TIMESTAMP(3),
    "preparingAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "outForDeliveryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "nameSnapshot" TEXT NOT NULL,
    "unitSnapshot" TEXT NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "public"."OrderStatus",
    "toStatus" "public"."OrderStatus" NOT NULL,
    "actorType" "public"."ActorType" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Delivery" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failReason" TEXT,
    "distanceMeters" INTEGER,
    "earning" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DeliveryOffer" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "public"."DeliveryOfferStatus" NOT NULL DEFAULT 'PENDING',
    "distanceMeters" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Review" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetType" "public"."ReviewTargetType" NOT NULL,
    "shopId" TEXT,
    "driverId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Wallet" (
    "id" TEXT NOT NULL,
    "ownerType" "public"."WalletOwnerType" NOT NULL,
    "shopId" TEXT,
    "driverId" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "public"."WalletTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "orderId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "public"."AdminAction" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "label" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'general',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "public"."User"("phone");
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");
CREATE INDEX "User_role_status_idx" ON "public"."User"("role", "status");
CREATE INDEX "User_createdAt_idx" ON "public"."User"("createdAt");
CREATE UNIQUE INDEX "CustomerProfile_userId_key" ON "public"."CustomerProfile"("userId");
CREATE UNIQUE INDEX "CustomerProfile_defaultAddressId_key" ON "public"."CustomerProfile"("defaultAddressId");
CREATE INDEX "Address_userId_idx" ON "public"."Address"("userId");
CREATE UNIQUE INDEX "Shop_ownerId_key" ON "public"."Shop"("ownerId");
CREATE INDEX "Shop_status_isOpen_idx" ON "public"."Shop"("status", "isOpen");
CREATE INDEX "Shop_latitude_longitude_idx" ON "public"."Shop"("latitude", "longitude");
CREATE INDEX "Shop_createdAt_idx" ON "public"."Shop"("createdAt");
CREATE UNIQUE INDEX "Category_slug_key" ON "public"."Category"("slug");
CREATE INDEX "Category_kind_sortOrder_idx" ON "public"."Category"("kind", "sortOrder");
CREATE INDEX "ShopProduct_shopId_isHidden_isAvailable_idx" ON "public"."ShopProduct"("shopId", "isHidden", "isAvailable");
CREATE INDEX "ShopProduct_shopId_categoryId_idx" ON "public"."ShopProduct"("shopId", "categoryId");
CREATE INDEX "ShopProduct_name_idx" ON "public"."ShopProduct"("name");
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "public"."DriverProfile"("userId");
CREATE UNIQUE INDEX "DriverProfile_currentOrderId_key" ON "public"."DriverProfile"("currentOrderId");
CREATE INDEX "DriverProfile_status_isAvailable_idx" ON "public"."DriverProfile"("status", "isAvailable");
CREATE INDEX "DriverProfile_latitude_longitude_idx" ON "public"."DriverProfile"("latitude", "longitude");
CREATE UNIQUE INDEX "Order_code_key" ON "public"."Order"("code");
CREATE INDEX "Order_customerId_createdAt_idx" ON "public"."Order"("customerId", "createdAt");
CREATE INDEX "Order_shopId_status_createdAt_idx" ON "public"."Order"("shopId", "status", "createdAt");
CREATE INDEX "Order_driverId_status_idx" ON "public"."Order"("driverId", "status");
CREATE INDEX "Order_status_createdAt_idx" ON "public"."Order"("status", "createdAt");
CREATE INDEX "Order_createdAt_idx" ON "public"."Order"("createdAt");
CREATE INDEX "OrderItem_orderId_idx" ON "public"."OrderItem"("orderId");
CREATE INDEX "OrderStatusEvent_orderId_createdAt_idx" ON "public"."OrderStatusEvent"("orderId", "createdAt");
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "public"."Delivery"("orderId");
CREATE INDEX "Delivery_driverId_createdAt_idx" ON "public"."Delivery"("driverId", "createdAt");
CREATE INDEX "DeliveryOffer_driverId_status_expiresAt_idx" ON "public"."DeliveryOffer"("driverId", "status", "expiresAt");
CREATE INDEX "DeliveryOffer_status_expiresAt_idx" ON "public"."DeliveryOffer"("status", "expiresAt");
CREATE UNIQUE INDEX "DeliveryOffer_orderId_driverId_key" ON "public"."DeliveryOffer"("orderId", "driverId");
CREATE INDEX "Review_shopId_createdAt_idx" ON "public"."Review"("shopId", "createdAt");
CREATE INDEX "Review_driverId_createdAt_idx" ON "public"."Review"("driverId", "createdAt");
CREATE UNIQUE INDEX "Review_orderId_targetType_key" ON "public"."Review"("orderId", "targetType");
CREATE UNIQUE INDEX "Wallet_shopId_key" ON "public"."Wallet"("shopId");
CREATE UNIQUE INDEX "Wallet_driverId_key" ON "public"."Wallet"("driverId");
CREATE INDEX "Wallet_ownerType_idx" ON "public"."Wallet"("ownerType");
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "public"."WalletTransaction"("walletId", "createdAt");
CREATE INDEX "WalletTransaction_orderId_idx" ON "public"."WalletTransaction"("orderId");
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "public"."Notification"("userId", "isRead", "createdAt");
CREATE INDEX "AdminAuditLog_actorId_createdAt_idx" ON "public"."AdminAuditLog"("actorId", "createdAt");
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "public"."AdminAuditLog"("targetType", "targetId");
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "public"."AdminAuditLog"("createdAt");
CREATE INDEX "PlatformSetting_group_idx" ON "public"."PlatformSetting"("group");

-- AddForeignKey
ALTER TABLE "public"."CustomerProfile" ADD CONSTRAINT "CustomerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."CustomerProfile" ADD CONSTRAINT "CustomerProfile_defaultAddressId_fkey" FOREIGN KEY ("defaultAddressId") REFERENCES "public"."Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Shop" ADD CONSTRAINT "Shop_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Shop" ADD CONSTRAINT "Shop_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."ShopProduct" ADD CONSTRAINT "ShopProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "public"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."ShopProduct" ADD CONSTRAINT "ShopProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "public"."Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."Order" ADD CONSTRAINT "Order_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "public"."Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."ShopProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."Delivery" ADD CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Delivery" ADD CONSTRAINT "Delivery_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."DeliveryOffer" ADD CONSTRAINT "DeliveryOffer_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."DeliveryOffer" ADD CONSTRAINT "DeliveryOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "public"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Review" ADD CONSTRAINT "Review_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Wallet" ADD CONSTRAINT "Wallet_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "public"."Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Wallet" ADD CONSTRAINT "Wallet_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."WalletTransaction" ADD CONSTRAINT "WalletTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PlatformSetting" ADD CONSTRAINT "PlatformSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
