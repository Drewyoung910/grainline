-- A Conversation remains one thread per participant pair. Preserve the
-- listing that prompted an individual message on that Message instead of
-- fragmenting the pair into duplicate threads or overwriting thread history.
--
-- This nullable preparation change is compatible with the currently deployed
-- application. It must land before application code starts writing/selecting
-- Message.contextListingId.
BEGIN;

ALTER TABLE "Message"
  ADD COLUMN "contextListingId" TEXT;

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_contextListingId_fkey"
  FOREIGN KEY ("contextListingId") REFERENCES "Listing"("id")
  ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "Message"
  VALIDATE CONSTRAINT "Message_contextListingId_fkey";

COMMIT;
