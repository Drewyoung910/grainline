-- AlterTable
ALTER TABLE "public"."Listing" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
