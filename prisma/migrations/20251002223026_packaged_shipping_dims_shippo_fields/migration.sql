-- AlterTable
ALTER TABLE "public"."Listing" ADD COLUMN     "packagedHeightCm" DOUBLE PRECISION,
ADD COLUMN     "packagedLengthCm" DOUBLE PRECISION,
ADD COLUMN     "packagedWeightGrams" INTEGER,
ADD COLUMN     "packagedWidthCm" DOUBLE PRECISION,
ADD COLUMN     "shipsSeparately" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "shippingCarrier" TEXT,
ADD COLUMN     "shippingEta" TIMESTAMP(3),
ADD COLUMN     "shippingService" TEXT;

-- AlterTable
ALTER TABLE "public"."SellerProfile" ADD COLUMN     "defaultMaxParcelWeightGrams" INTEGER,
ADD COLUMN     "defaultPkgHeightCm" DOUBLE PRECISION,
ADD COLUMN     "defaultPkgLengthCm" DOUBLE PRECISION,
ADD COLUMN     "defaultPkgWidthCm" DOUBLE PRECISION,
ADD COLUMN     "shipFromCity" TEXT,
ADD COLUMN     "shipFromCountry" TEXT,
ADD COLUMN     "shipFromLine1" TEXT,
ADD COLUMN     "shipFromLine2" TEXT,
ADD COLUMN     "shipFromName" TEXT,
ADD COLUMN     "shipFromPostal" TEXT,
ADD COLUMN     "shipFromState" TEXT;
