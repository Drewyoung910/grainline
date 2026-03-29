-- AlterTable
ALTER TABLE "public"."Order" ADD COLUMN     "quotedShipToCity" TEXT,
ADD COLUMN     "quotedShipToCountry" TEXT,
ADD COLUMN     "quotedShipToPostalCode" TEXT,
ADD COLUMN     "quotedShipToState" TEXT,
ADD COLUMN     "quotedShippingAmountCents" INTEGER,
ADD COLUMN     "reviewNeeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewNote" TEXT;
