-- AlterTable
ALTER TABLE "public"."Listing" ADD COLUMN     "customOrderConversationId" TEXT,
ADD COLUMN     "isPrivate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reservedForUserId" TEXT;

-- AlterTable
ALTER TABLE "public"."Message" ADD COLUMN     "kind" TEXT;

-- AddForeignKey
ALTER TABLE "public"."Listing" ADD CONSTRAINT "Listing_reservedForUserId_fkey" FOREIGN KEY ("reservedForUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
