-- Add an atomic throttle marker for new-message notification emails.
ALTER TABLE "Conversation"
  ADD COLUMN "lastMessageEmailSentAt" TIMESTAMP(3);
