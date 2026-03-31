-- CreateTable
CREATE TABLE "public"."ListingViewDaily" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListingViewDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingViewDaily_sellerProfileId_date_idx" ON "public"."ListingViewDaily"("sellerProfileId", "date");

-- CreateIndex
CREATE INDEX "ListingViewDaily_date_idx" ON "public"."ListingViewDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ListingViewDaily_listingId_date_key" ON "public"."ListingViewDaily"("listingId", "date");

-- AddForeignKey
ALTER TABLE "public"."ListingViewDaily" ADD CONSTRAINT "ListingViewDaily_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "public"."Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ListingViewDaily" ADD CONSTRAINT "ListingViewDaily_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "public"."SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
