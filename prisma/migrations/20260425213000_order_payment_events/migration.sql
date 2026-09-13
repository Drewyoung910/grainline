-- CreateTable
CREATE TABLE "OrderPaymentEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "stripeObjectId" TEXT,
    "stripeObjectType" TEXT,
    "eventType" TEXT NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT,
    "reason" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderPaymentEvent_stripeEventId_key" ON "OrderPaymentEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "OrderPaymentEvent_orderId_createdAt_idx" ON "OrderPaymentEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderPaymentEvent_eventType_createdAt_idx" ON "OrderPaymentEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "OrderPaymentEvent_stripeObjectId_idx" ON "OrderPaymentEvent"("stripeObjectId");

-- AddForeignKey
ALTER TABLE "OrderPaymentEvent" ADD CONSTRAINT "OrderPaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
