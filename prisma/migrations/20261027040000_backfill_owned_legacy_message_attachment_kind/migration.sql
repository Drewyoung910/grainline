-- Restore the durable Message.kind marker only for legacy structured file
-- messages whose referenced public object is durably owned by the sender.
--
-- Older message attachments stored {kind,url,name,type} in Message.body but
-- left Message.kind NULL. Body shape and a shared-host URL are not authority:
-- an ordinary message can contain either. DirectUpload.userId plus the exact
-- public URL and a message endpoint are the durable ownership witness. Rows
-- that predate DirectUpload, reference another user's object, use a non-message
-- endpoint, contain malformed JSON, or contain only a raw URL remain ordinary
-- text. This deliberately prefers an unavailable legacy presentation over
-- reintroducing attachment spoofing.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'grainline.message-attachment-kind.backfill',
    0
  )
);

DO $grainline_message_attachment_kind_preflight$
DECLARE
  message_column_count integer;
  upload_column_count integer;
BEGIN
  IF pg_catalog.to_regclass('public."Message"') IS NULL
     OR pg_catalog.to_regclass('public."DirectUpload"') IS NULL THEN
    RAISE EXCEPTION 'Message attachment kind backfill tables are missing';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO message_column_count
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = 'public."Message"'::pg_catalog.regclass
     AND attribute.attname = ANY (
       ARRAY['id', 'senderId', 'body', 'kind', 'isSystemMessage']::name[]
     )
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF message_column_count <> 5 THEN
    RAISE EXCEPTION 'Message attachment kind backfill column contract drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO upload_column_count
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = 'public."DirectUpload"'::pg_catalog.regclass
     AND attribute.attname = ANY (
       ARRAY[
         'userId',
         'endpoint',
         'publicUrl',
         'storageClass',
         'status',
         'deletedAt'
       ]::name[]
     )
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF upload_column_count <> 6 THEN
    RAISE EXCEPTION 'DirectUpload ownership witness column contract drifted';
  END IF;
END
$grainline_message_attachment_kind_preflight$;

-- Message writers insert the row before synchronizing its DirectUpload
-- reference. Taking Message first follows that order and prevents a lock cycle.
LOCK TABLE public."Message" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public."DirectUpload" IN SHARE MODE;

CREATE TEMPORARY TABLE grainline_message_attachment_kind_candidates
ON COMMIT DROP
AS
SELECT
  message.id,
  message.body
FROM public."Message" AS message
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN message.body IS JSON OBJECT THEN message.body::jsonb
    ELSE NULL::jsonb
  END AS payload
) AS parsed
WHERE message.kind IS NULL
  AND message."isSystemMessage" = false
  AND pg_catalog.jsonb_typeof(parsed.payload) = 'object'
  AND parsed.payload ->> 'kind' = 'file'
  AND pg_catalog.jsonb_typeof(parsed.payload -> 'url') = 'string'
  AND pg_catalog.btrim(parsed.payload ->> 'url') <> ''
  AND pg_catalog.char_length(
        pg_catalog.btrim(parsed.payload ->> 'url')
      ) <= 2048
  AND EXISTS (
    SELECT 1
      FROM public."DirectUpload" AS upload
     WHERE upload."userId" = message."senderId"
       AND upload.endpoint IN ('messageImage', 'messageFile', 'messageAny')
       AND upload."storageClass" = 'PUBLIC'
       AND upload."publicUrl" = pg_catalog.btrim(parsed.payload ->> 'url')
       AND upload.status IN ('VERIFIED', 'CLAIMED')
       AND upload."deletedAt" IS NULL
  );

DO $grainline_message_attachment_kind_backfill$
DECLARE
  expected_count integer;
  updated_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO expected_count
    FROM grainline_message_attachment_kind_candidates;

  UPDATE public."Message" AS message
     SET kind = 'file'
    FROM grainline_message_attachment_kind_candidates AS candidate
   WHERE message.id = candidate.id
     AND message.kind IS NULL
     AND message.body = candidate.body;
  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count <> expected_count THEN
    RAISE EXCEPTION
      'Message attachment kind backfill changed during execution: expected=% updated=%',
      expected_count,
      updated_count;
  END IF;
END
$grainline_message_attachment_kind_backfill$;

DO $grainline_message_attachment_kind_postflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM grainline_message_attachment_kind_candidates AS candidate
      JOIN public."Message" AS message
        ON message.id = candidate.id
     WHERE message.kind IS DISTINCT FROM 'file'
        OR message.body IS DISTINCT FROM candidate.body
  ) THEN
    RAISE EXCEPTION 'Message attachment kind backfill postflight failed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Message" AS message
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN message.body IS JSON OBJECT THEN message.body::jsonb
        ELSE NULL::jsonb
      END AS payload
    ) AS parsed
     WHERE message.kind IS NULL
       AND message."isSystemMessage" = false
       AND pg_catalog.jsonb_typeof(parsed.payload) = 'object'
       AND parsed.payload ->> 'kind' = 'file'
       AND pg_catalog.jsonb_typeof(parsed.payload -> 'url') = 'string'
       AND pg_catalog.btrim(parsed.payload ->> 'url') <> ''
       AND pg_catalog.char_length(
             pg_catalog.btrim(parsed.payload ->> 'url')
           ) <= 2048
       AND EXISTS (
         SELECT 1
           FROM public."DirectUpload" AS upload
          WHERE upload."userId" = message."senderId"
            AND upload.endpoint IN (
              'messageImage',
              'messageFile',
              'messageAny'
            )
            AND upload."storageClass" = 'PUBLIC'
            AND upload."publicUrl" =
              pg_catalog.btrim(parsed.payload ->> 'url')
            AND upload.status IN ('VERIFIED', 'CLAIMED')
            AND upload."deletedAt" IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'Eligible legacy message attachments remain unclassified';
  END IF;
END
$grainline_message_attachment_kind_postflight$;

COMMIT;
