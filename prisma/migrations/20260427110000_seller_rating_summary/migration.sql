-- Persist seller-level rating aggregates so browse filters do not scan the full
-- Review table on every request.
CREATE TABLE "SellerRatingSummary" (
  "sellerProfileId" TEXT NOT NULL,
  "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reviewCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SellerRatingSummary_pkey" PRIMARY KEY ("sellerProfileId"),
  CONSTRAINT "SellerRatingSummary_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId")
    REFERENCES "SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SellerRatingSummary_averageRating_reviewCount_idx"
  ON "SellerRatingSummary"("averageRating", "reviewCount");

INSERT INTO "SellerRatingSummary" ("sellerProfileId", "averageRating", "reviewCount", "updatedAt")
SELECT
  l."sellerId",
  AVG(r."ratingX2")::float / 2.0 AS "averageRating",
  COUNT(r.id)::integer AS "reviewCount",
  CURRENT_TIMESTAMP AS "updatedAt"
FROM "Review" r
JOIN "Listing" l ON l.id = r."listingId"
GROUP BY l."sellerId";
