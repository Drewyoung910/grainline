CREATE TABLE "CheckoutStockReservation" (
  "id" TEXT NOT NULL,
  "checkoutLockKey" VARCHAR(255) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "buyerId" VARCHAR(191),
  "sellerId" VARCHAR(191),
  "stripeSessionId" VARCHAR(255),
  "status" VARCHAR(32) NOT NULL DEFAULT 'RESERVED',
  "reservedItems" JSONB NOT NULL DEFAULT '[]',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "restoredAt" TIMESTAMP(3),
  "restoreReason" VARCHAR(100),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CheckoutStockReservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutStockReservation_stripeSessionId_key"
  ON "CheckoutStockReservation"("stripeSessionId");

CREATE INDEX "CheckoutStockReservation_checkoutLockKey_idx"
  ON "CheckoutStockReservation"("checkoutLockKey");

CREATE INDEX "CheckoutStockReservation_status_expiresAt_idx"
  ON "CheckoutStockReservation"("status", "expiresAt");

CREATE INDEX "CheckoutStockReservation_buyerId_createdAt_idx"
  ON "CheckoutStockReservation"("buyerId", "createdAt");

CREATE INDEX "CheckoutStockReservation_sellerId_createdAt_idx"
  ON "CheckoutStockReservation"("sellerId", "createdAt");

ALTER TABLE "CheckoutStockReservation"
  ADD CONSTRAINT "CheckoutStockReservation_status_chk"
  CHECK ("status" IN ('RESERVED', 'SESSION_CREATED', 'COMPLETED', 'RESTORED')) NOT VALID;

ALTER TABLE "CheckoutStockReservation"
  VALIDATE CONSTRAINT "CheckoutStockReservation_status_chk";

ALTER TABLE "CheckoutStockReservation"
  ADD CONSTRAINT "CheckoutStockReservation_reservedItems_array_chk"
  CHECK (jsonb_typeof("reservedItems") = 'array') NOT VALID;

ALTER TABLE "CheckoutStockReservation"
  VALIDATE CONSTRAINT "CheckoutStockReservation_reservedItems_array_chk";
