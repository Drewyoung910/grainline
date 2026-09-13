-- Compatible fixed authority for one Case reply and its optional private
-- evidence attachments. Direct Case-family grants and RLS posture remain
-- unchanged so old and new application deployments can coexist.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_reply(
  p_actor_user_id text,
  p_case_id text,
  p_body text,
  p_direct_upload_ids text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_reply$
DECLARE
  locked_actor record;
  locked_case record;
  duplicate_message record;
  upload record;
  attachment record;
  normalized_upload_ids text[];
  attachment_results jsonb := '[]'::jsonb;
  transition_at timestamp(3);
  duplicate_cutoff timestamp(3);
  target_message_id text;
  target_attachment_id text;
  actor_kind public."CaseMessageAuthorKind";
  actor_is_party boolean;
  actor_acts_as_staff boolean;
  resulting_status public."CaseStatus";
  duplicate_key text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR pg_catalog.char_length(p_actor_user_id) > 191
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191
     OR p_body IS NULL
     OR p_body IS DISTINCT FROM pg_catalog.btrim(p_body)
     OR pg_catalog.char_length(p_body) < 1
     OR pg_catalog.char_length(p_body) > 5000
     OR pg_catalog.octet_length(p_body) > 20000
     OR p_direct_upload_ids IS NULL
     OR pg_catalog.array_ndims(p_direct_upload_ids) > 1
     OR COALESCE(
          pg_catalog.array_length(p_direct_upload_ids, 1),
          0
        ) > 4 THEN
    RAISE EXCEPTION 'Case-reply input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(value ORDER BY value),
           ARRAY[]::text[]
         )
    INTO normalized_upload_ids
    FROM pg_catalog.unnest(p_direct_upload_ids) AS value;
  IF EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(normalized_upload_ids) AS value
        WHERE value IS NULL
           OR value = ''
           OR pg_catalog.char_length(value) > 191
     )
     OR COALESCE(
          pg_catalog.array_length(normalized_upload_ids, 1),
          0
        ) <> (
          SELECT pg_catalog.count(DISTINCT value)::integer
            FROM pg_catalog.unnest(normalized_upload_ids) AS value
        ) THEN
    RAISE EXCEPTION 'Case-reply upload identity is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.id,
    actor.role,
    actor.banned,
    actor."deletedAt",
    actor."clerkId"
    INTO locked_actor
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id
   FOR SHARE;
  IF NOT FOUND
     OR locked_actor.banned
     OR locked_actor."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Case-reply actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status,
    case_row."discussionStartedAt",
    case_row."escalateUnlocksAt",
    case_row."buyerMarkedResolved",
    case_row."sellerMarkedResolved",
    buyer.banned AS buyer_banned,
    buyer."deletedAt" AS buyer_deleted_at,
    seller.banned AS seller_banned,
    seller."deletedAt" AS seller_deleted_at
    INTO locked_case
    FROM public."Case" AS case_row
    LEFT JOIN public."User" AS buyer ON buyer.id = case_row."buyerId"
    LEFT JOIN public."User" AS seller ON seller.id = case_row."sellerId"
   WHERE case_row.id = p_case_id
   FOR UPDATE OF case_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case-reply Case does not exist'
      USING ERRCODE = '23503';
  END IF;

  actor_is_party :=
    locked_actor.id = locked_case."buyerId"
    OR locked_actor.id = locked_case."sellerId";
  actor_acts_as_staff :=
    NOT actor_is_party
    AND locked_actor.role IN (
      'EMPLOYEE'::public."Role",
      'ADMIN'::public."Role"
    );
  IF NOT actor_is_party AND NOT actor_acts_as_staff THEN
    RAISE EXCEPTION 'Case-reply actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF (
       actor_acts_as_staff
       AND locked_case.status NOT IN (
         'OPEN'::public."CaseStatus",
         'IN_DISCUSSION'::public."CaseStatus",
         'PENDING_CLOSE'::public."CaseStatus",
         'UNDER_REVIEW'::public."CaseStatus"
       )
     )
     OR (
       NOT actor_acts_as_staff
       AND locked_case.status NOT IN (
         'OPEN'::public."CaseStatus",
         'IN_DISCUSSION'::public."CaseStatus",
         'PENDING_CLOSE'::public."CaseStatus"
       )
     ) THEN
    RAISE EXCEPTION 'Case-reply Case is closed'
      USING ERRCODE = '23514';
  END IF;

  IF NOT actor_acts_as_staff THEN
    IF locked_actor.id = locked_case."buyerId" THEN
      IF locked_case."sellerId" IS NULL THEN
        RAISE EXCEPTION 'Case-reply recipient is missing'
          USING ERRCODE = '23514';
      ELSIF locked_case.seller_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Case-reply recipient is deleted'
          USING ERRCODE = '23514';
      ELSIF locked_case.seller_banned THEN
        RAISE EXCEPTION 'Case-reply recipient is suspended'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF locked_case."buyerId" IS NULL THEN
        RAISE EXCEPTION 'Case-reply recipient is missing'
          USING ERRCODE = '23514';
      ELSIF locked_case.buyer_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Case-reply recipient is deleted'
          USING ERRCODE = '23514';
      ELSIF locked_case.buyer_banned THEN
        RAISE EXCEPTION 'Case-reply recipient is suspended'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  actor_kind := CASE
    WHEN locked_actor.id = locked_case."buyerId"
      THEN 'BUYER'::public."CaseMessageAuthorKind"
    WHEN locked_actor.id = locked_case."sellerId"
      THEN 'SELLER'::public."CaseMessageAuthorKind"
    ELSE 'STAFF'::public."CaseMessageAuthorKind"
  END;
  transition_at := pg_catalog.timezone(
    'UTC',
    pg_catalog.clock_timestamp()
  );
  duplicate_cutoff := transition_at - INTERVAL '30 seconds';
  duplicate_key := pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        locked_case.id
          || ':' || locked_actor.id
          || ':' || p_body
          || ':' || pg_catalog.array_to_string(
            normalized_upload_ids,
            ','
          ),
        'UTF8'
      )
    ),
    'hex'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'case-reply:' || duplicate_key,
      0
    )
  );

  SELECT
    message.id,
    message."createdAt",
    message."authorKind"
    INTO duplicate_message
    FROM public."CaseMessage" AS message
   WHERE message."caseId" = locked_case.id
     AND message."authorId" = locked_actor.id
     AND message.body = p_body
     AND message."createdAt" >= duplicate_cutoff
     AND (
       SELECT COALESCE(
                pg_catalog.array_agg(
                  row."directUploadId"
                  ORDER BY row."directUploadId"
                ),
                ARRAY[]::text[]
              )
         FROM public."CaseMessageAttachment" AS row
        WHERE row."caseMessageId" = message.id
     ) = normalized_upload_ids
   ORDER BY message."createdAt" DESC, message.id DESC
   LIMIT 1
   FOR SHARE OF message;

  IF FOUND THEN
    SELECT COALESCE(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'id', row.id,
                 'contentType', row."contentType",
                 'byteSize', row."byteSize",
                 'createdAt', pg_catalog.to_char(
                   row."createdAt",
                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                 )
               )
               ORDER BY row."createdAt", row.id
             ),
             '[]'::jsonb
           )
      INTO attachment_results
      FROM public."CaseMessageAttachment" AS row
     WHERE row."caseMessageId" = duplicate_message.id;
    RETURN pg_catalog.jsonb_build_object(
      'caseId', locked_case.id,
      'orderId', locked_case."orderId",
      'buyerUserId', locked_case."buyerId",
      'sellerUserId', locked_case."sellerId",
      'messageId', duplicate_message.id,
      'authorUserId', locked_actor.id,
      'authorKind', duplicate_message."authorKind"::text,
      'status', locked_case.status::text,
      'actsAsStaff', actor_acts_as_staff,
      'createdAt', pg_catalog.to_char(
        duplicate_message."createdAt",
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'attachments', attachment_results,
      'action', 'replay'
    );
  END IF;

  IF COALESCE(
       pg_catalog.array_length(normalized_upload_ids, 1),
       0
     ) > 0 THEN
    FOR upload IN
      SELECT
        row.id,
        row.key,
        row."userId",
        row.endpoint,
        row."publicUrl",
        row."storageClass",
        row."contentType",
        row."expectedSize",
        row.status,
        row."verifiedAt"
        FROM public."DirectUpload" AS row
       WHERE row.id = ANY (normalized_upload_ids)
       ORDER BY row.id
       FOR UPDATE
    LOOP
      IF upload."userId" IS DISTINCT FROM locked_actor.id
         OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
         OR upload."publicUrl" IS NOT NULL
         OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
         OR upload.status IS DISTINCT FROM 'VERIFIED'
         OR upload."verifiedAt" IS NULL
         OR upload."contentType" NOT IN (
           'image/jpeg',
           'image/png',
           'image/webp'
         )
         OR upload."expectedSize" <= 0
         OR upload."expectedSize" > 8388608
         OR pg_catalog.split_part(upload.key, '/', 1)
              IS DISTINCT FROM 'caseEvidenceImage'
         OR pg_catalog.split_part(upload.key, '/', 3)
              IS DISTINCT FROM locked_case.id
         OR pg_catalog.split_part(upload.key, '/', 4) = ''
         OR pg_catalog.split_part(upload.key, '/', 5) <> '' THEN
        RAISE EXCEPTION 'Case-reply upload authority is invalid'
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
    IF (
      SELECT pg_catalog.count(*)::integer
        FROM public."DirectUpload" AS row
       WHERE row.id = ANY (normalized_upload_ids)
    ) <> pg_catalog.array_length(normalized_upload_ids, 1) THEN
      RAISE EXCEPTION 'Case-reply upload does not exist'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  resulting_status := locked_case.status;
  IF locked_case.status = 'OPEN'::public."CaseStatus"
     AND locked_actor.id = locked_case."sellerId" THEN
    resulting_status := 'IN_DISCUSSION'::public."CaseStatus";
    UPDATE public."Case"
       SET status = resulting_status,
           "discussionStartedAt" = transition_at,
           "escalateUnlocksAt" =
             transition_at + INTERVAL '48 hours',
           "updatedAt" = transition_at
     WHERE id = locked_case.id;
  ELSIF locked_case.status = 'PENDING_CLOSE'::public."CaseStatus"
        AND actor_is_party THEN
    resulting_status := 'IN_DISCUSSION'::public."CaseStatus";
    UPDATE public."Case"
       SET status = resulting_status,
           "buyerMarkedResolved" = false,
           "sellerMarkedResolved" = false,
           "updatedAt" = transition_at
     WHERE id = locked_case.id;
  ELSE
    UPDATE public."Case"
       SET "updatedAt" = transition_at
     WHERE id = locked_case.id;
  END IF;

  target_message_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."CaseMessage" (
    id,
    "caseId",
    "authorId",
    "authorKind",
    body,
    "createdAt"
  )
  VALUES (
    target_message_id,
    locked_case.id,
    locked_actor.id,
    actor_kind,
    p_body,
    transition_at
  );

  FOR upload IN
    SELECT
      row.id,
      row.key,
      row."contentType",
      row."expectedSize"
      FROM public."DirectUpload" AS row
     WHERE row.id = ANY (normalized_upload_ids)
     ORDER BY row.id
  LOOP
    target_attachment_id := pg_catalog.gen_random_uuid()::text;
    INSERT INTO public."CaseMessageAttachment" (
      id,
      "caseMessageId",
      "uploaderId",
      "directUploadId",
      "objectKey",
      "contentType",
      "byteSize",
      "createdAt"
    )
    VALUES (
      target_attachment_id,
      target_message_id,
      locked_actor.id,
      upload.id,
      upload.key,
      upload."contentType",
      upload."expectedSize",
      transition_at
    );
    attachment_results := attachment_results
      || pg_catalog.jsonb_build_array(
           pg_catalog.jsonb_build_object(
             'id', target_attachment_id,
             'contentType', upload."contentType",
             'byteSize', upload."expectedSize",
             'createdAt', pg_catalog.to_char(
               transition_at,
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             )
           )
         );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'caseId', locked_case.id,
    'orderId', locked_case."orderId",
    'buyerUserId', locked_case."buyerId",
    'sellerUserId', locked_case."sellerId",
    'messageId', target_message_id,
    'authorUserId', locked_actor.id,
    'authorKind', actor_kind::text,
    'status', resulting_status::text,
    'actsAsStaff', actor_acts_as_staff,
    'createdAt', pg_catalog.to_char(
      transition_at,
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'attachments', attachment_results,
    'action', 'created'
  );
END
$grainline_case_reply$;

REVOKE ALL ON FUNCTION
  public.grainline_case_reply(text, text, text, text[])
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_reply(text, text, text, text[])
  TO grainline_app_runtime;

COMMIT;
