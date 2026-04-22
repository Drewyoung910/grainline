-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "materials" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "productHeightIn" DOUBLE PRECISION,
ADD COLUMN     "productLengthIn" DOUBLE PRECISION,
ADD COLUMN     "productWidthIn" DOUBLE PRECISION;
