-- CreateTable
CREATE TABLE "public"."StockNotification" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockNotification_listingId_idx" ON "public"."StockNotification"("listingId");

-- CreateIndex
CREATE INDEX "StockNotification_userId_idx" ON "public"."StockNotification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StockNotification_listingId_userId_key" ON "public"."StockNotification"("listingId", "userId");

-- AddForeignKey
ALTER TABLE "public"."StockNotification" ADD CONSTRAINT "StockNotification_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "public"."Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StockNotification" ADD CONSTRAINT "StockNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
