-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "giftNote" TEXT,
ADD COLUMN     "giftWrapping" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."SellerProfile" ADD COLUMN     "acceptingNewOrders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "acceptsCustomOrders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bannerImageUrl" TEXT,
ADD COLUMN     "customOrderPolicy" TEXT,
ADD COLUMN     "customOrderTurnaroundDays" INTEGER,
ADD COLUMN     "facebookUrl" TEXT,
ADD COLUMN     "featuredListingIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "galleryImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "giftWrappingPriceCents" INTEGER,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "isVerifiedMaker" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offersGiftWrapping" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinterestUrl" TEXT,
ADD COLUMN     "returnPolicy" TEXT,
ADD COLUMN     "shippingPolicy" TEXT,
ADD COLUMN     "storyBody" TEXT,
ADD COLUMN     "storyTitle" TEXT,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "tiktokUrl" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "websiteUrl" TEXT,
ADD COLUMN     "workshopImageUrl" TEXT,
ADD COLUMN     "yearsInBusiness" INTEGER;

-- CreateTable
CREATE TABLE "public"."SellerFaq" (
    "id" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerFaq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellerFaq_sellerProfileId_sortOrder_idx" ON "public"."SellerFaq"("sellerProfileId", "sortOrder");

-- AddForeignKey
ALTER TABLE "public"."SellerFaq" ADD CONSTRAINT "SellerFaq_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "public"."SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
