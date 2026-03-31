-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."NotificationType" ADD VALUE 'FOLLOWED_MAKER_NEW_LISTING';
ALTER TYPE "public"."NotificationType" ADD VALUE 'FOLLOWED_MAKER_NEW_BLOG';
ALTER TYPE "public"."NotificationType" ADD VALUE 'SELLER_BROADCAST';

-- CreateTable
CREATE TABLE "public"."Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SavedBlogPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "blogPostId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedBlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SellerBroadcast" (
    "id" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "imageUrl" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SellerBroadcast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Follow_sellerProfileId_idx" ON "public"."Follow"("sellerProfileId");

-- CreateIndex
CREATE INDEX "Follow_followerId_idx" ON "public"."Follow"("followerId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_sellerProfileId_key" ON "public"."Follow"("followerId", "sellerProfileId");

-- CreateIndex
CREATE INDEX "SavedBlogPost_userId_idx" ON "public"."SavedBlogPost"("userId");

-- CreateIndex
CREATE INDEX "SavedBlogPost_blogPostId_idx" ON "public"."SavedBlogPost"("blogPostId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedBlogPost_userId_blogPostId_key" ON "public"."SavedBlogPost"("userId", "blogPostId");

-- CreateIndex
CREATE INDEX "SellerBroadcast_sellerProfileId_idx" ON "public"."SellerBroadcast"("sellerProfileId");

-- CreateIndex
CREATE INDEX "SellerBroadcast_sentAt_idx" ON "public"."SellerBroadcast"("sentAt");

-- AddForeignKey
ALTER TABLE "public"."Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Follow" ADD CONSTRAINT "Follow_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "public"."SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavedBlogPost" ADD CONSTRAINT "SavedBlogPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SavedBlogPost" ADD CONSTRAINT "SavedBlogPost_blogPostId_fkey" FOREIGN KEY ("blogPostId") REFERENCES "public"."BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SellerBroadcast" ADD CONSTRAINT "SellerBroadcast_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "public"."SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
