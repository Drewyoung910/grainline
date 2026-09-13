-- Clean up pre-existing orphaned custom-order conversation references before
-- adding the database-level foreign key.
UPDATE "Listing"
SET "customOrderConversationId" = NULL
WHERE "customOrderConversationId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Conversation"
    WHERE "Conversation"."id" = "Listing"."customOrderConversationId"
  );

-- Bound historically unbounded text columns before adding VarChar limits.
UPDATE "EmailOutbox"
SET "html" = LEFT("html", 200000)
WHERE LENGTH("html") > 200000;

UPDATE "OrderPaymentEvent"
SET "description" = LEFT("description", 5000)
WHERE "description" IS NOT NULL
  AND LENGTH("description") > 5000;

ALTER TABLE "EmailOutbox"
ALTER COLUMN "html" TYPE VARCHAR(200000);

ALTER TABLE "OrderPaymentEvent"
ALTER COLUMN "description" TYPE VARCHAR(5000);

CREATE INDEX "Listing_customOrderConversationId_idx"
ON "Listing"("customOrderConversationId");

ALTER TABLE "Listing"
ADD CONSTRAINT "Listing_customOrderConversationId_fkey"
FOREIGN KEY ("customOrderConversationId")
REFERENCES "Conversation"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
