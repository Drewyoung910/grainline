-- CreateEnum
CREATE TYPE "public"."VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "public"."MakerVerification" (
    "id" TEXT NOT NULL,
    "sellerProfileId" TEXT NOT NULL,
    "craftDescription" TEXT NOT NULL,
    "yearsExperience" INTEGER NOT NULL,
    "portfolioUrl" TEXT,
    "status" "public"."VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewNotes" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "MakerVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MakerVerification_sellerProfileId_key" ON "public"."MakerVerification"("sellerProfileId");

-- AddForeignKey
ALTER TABLE "public"."MakerVerification" ADD CONSTRAINT "MakerVerification_sellerProfileId_fkey" FOREIGN KEY ("sellerProfileId") REFERENCES "public"."SellerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MakerVerification" ADD CONSTRAINT "MakerVerification_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
