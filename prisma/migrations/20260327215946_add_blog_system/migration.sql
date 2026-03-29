-- CreateEnum
CREATE TYPE "public"."BlogPostType" AS ENUM ('STANDARD', 'MAKER_SPOTLIGHT', 'BEHIND_THE_BUILD', 'GIFT_GUIDE', 'WOOD_EDUCATION');

-- CreateEnum
CREATE TYPE "public"."BlogPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."BlogAuthorType" AS ENUM ('STAFF', 'MAKER');

-- CreateTable
CREATE TABLE "public"."BlogPost" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "videoUrl" TEXT,
    "authorId" TEXT NOT NULL,
    "authorType" "public"."BlogAuthorType" NOT NULL,
    "sellerProfileId" TEXT,
    "type" "public"."BlogPostType" NOT NULL DEFAULT 'STANDARD',
    "status" "public"."BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
    "featuredListingIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metaDescription" TEXT,
    "readingTimeMinutes" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BlogComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlogComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "public"."BlogPost"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "public"."BlogPost"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "BlogPost_authorId_idx" ON "public"."BlogPost"("authorId");

-- CreateIndex
CREATE INDEX "BlogPost_sellerProfileId_idx" ON "public"."BlogPost"("sellerProfileId");

-- CreateIndex
CREATE INDEX "BlogComment_postId_idx" ON "public"."BlogComment"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSubscriber_email_key" ON "public"."NewsletterSubscriber"("email");

-- AddForeignKey
ALTER TABLE "public"."BlogPost" ADD CONSTRAINT "BlogPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BlogPost" ADD CONSTRAINT "BlogPost_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "public"."SellerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BlogComment" ADD CONSTRAINT "BlogComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BlogComment" ADD CONSTRAINT "BlogComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
