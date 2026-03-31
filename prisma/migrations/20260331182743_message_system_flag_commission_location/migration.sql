-- AlterTable
ALTER TABLE "public"."CommissionRequest" ADD COLUMN     "isNational" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "radiusMeters" INTEGER DEFAULT 80000;

-- AlterTable
ALTER TABLE "public"."Message" ADD COLUMN     "isSystemMessage" BOOLEAN NOT NULL DEFAULT false;
