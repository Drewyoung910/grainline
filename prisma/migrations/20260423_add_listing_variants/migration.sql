-- CreateTable
CREATE TABLE "ListingVariantGroup" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ListingVariantGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingVariantOption" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceAdjustCents" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "inStock" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ListingVariantOption_pkey" PRIMARY KEY ("id")
);

-- AlterTable: OrderItem - add selectedVariants
ALTER TABLE "OrderItem" ADD COLUMN "selectedVariants" JSONB;

-- AlterTable: CartItem - add variant fields
ALTER TABLE "CartItem" ADD COLUMN "selectedVariantOptionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CartItem" ADD COLUMN "variantKey" TEXT NOT NULL DEFAULT '';

-- Drop old unique constraint on CartItem
ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_cartId_listingId_key";

-- New unique constraint including variantKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_listingId_variantKey_key" UNIQUE ("cartId", "listingId", "variantKey");

-- CreateIndex
CREATE INDEX "ListingVariantGroup_listingId_sortOrder_idx" ON "ListingVariantGroup"("listingId", "sortOrder");

-- CreateIndex
CREATE INDEX "ListingVariantOption_groupId_sortOrder_idx" ON "ListingVariantOption"("groupId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ListingVariantGroup" ADD CONSTRAINT "ListingVariantGroup_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingVariantOption" ADD CONSTRAINT "ListingVariantOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ListingVariantGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
