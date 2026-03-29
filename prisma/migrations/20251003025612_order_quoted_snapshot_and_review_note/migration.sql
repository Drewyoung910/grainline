/*
  Warnings:

  - You are about to drop the column `quotedShipToCity` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `quotedShipToCountry` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `quotedShipToPostalCode` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `quotedShipToState` on the `Order` table. All the data in the column will be lost.
  - You are about to drop the column `quotedShippingAmountCents` on the `Order` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."Order" DROP COLUMN "quotedShipToCity",
DROP COLUMN "quotedShipToCountry",
DROP COLUMN "quotedShipToPostalCode",
DROP COLUMN "quotedShipToState",
DROP COLUMN "quotedShippingAmountCents",
ADD COLUMN     "quotedAt" TIMESTAMP(3),
ADD COLUMN     "quotedToCity" TEXT,
ADD COLUMN     "quotedToCountry" TEXT,
ADD COLUMN     "quotedToLine1" TEXT,
ADD COLUMN     "quotedToLine2" TEXT,
ADD COLUMN     "quotedToPostalCode" TEXT,
ADD COLUMN     "quotedToState" TEXT,
ADD COLUMN     "quotedUseCalculatedShipping" BOOLEAN;
