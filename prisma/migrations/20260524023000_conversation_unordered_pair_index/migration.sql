DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Conversation"
    GROUP BY LEAST("userAId", "userBId"), GREATEST("userAId", "userBId")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate unordered Conversation participant pairs exist; merge them before adding Conversation_unordered_user_pair_key';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_unordered_user_pair_key"
  ON "Conversation" (
    LEAST("userAId", "userBId"),
    GREATEST("userAId", "userBId")
  );
