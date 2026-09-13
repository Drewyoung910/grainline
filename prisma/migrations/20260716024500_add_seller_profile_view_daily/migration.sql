-- Track seller profile views by UTC day so analytics date ranges do not use
-- the legacy all-time SellerProfile.profileViews counter.
CREATE TABLE "public"."SellerProfileViewDaily" (
  "id" TEXT NOT NULL,
  "sellerProfileId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "SellerProfileViewDaily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerProfileViewDaily_sellerProfileId_date_key"
  ON "public"."SellerProfileViewDaily"("sellerProfileId", "date");

CREATE INDEX "SellerProfileViewDaily_sellerProfileId_date_idx"
  ON "public"."SellerProfileViewDaily"("sellerProfileId", "date");

CREATE INDEX "SellerProfileViewDaily_date_idx"
  ON "public"."SellerProfileViewDaily"("date");

ALTER TABLE "public"."SellerProfileViewDaily"
  ADD CONSTRAINT "SellerProfileViewDaily_sellerProfileId_fkey"
  FOREIGN KEY ("sellerProfileId")
  REFERENCES "public"."SellerProfile"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
