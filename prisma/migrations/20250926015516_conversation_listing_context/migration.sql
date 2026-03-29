-- AlterTable
ALTER TABLE "public"."Conversation" ADD COLUMN     "contextListingId" TEXT;

-- AddForeignKey
ALTER TABLE "public"."Conversation" ADD CONSTRAINT "Conversation_contextListingId_fkey" FOREIGN KEY ("contextListingId") REFERENCES "public"."Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
