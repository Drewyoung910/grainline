-- Promoted reviewed DirectUpload compatibility-key retirement migration.
-- Apply only through the guarded main-only production migration workflow.
-- DirectUpload RLS activation, table-grant narrowing and cleanup scheduling
-- remain separate later releases.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.direct-upload.rls.activation', 0)
);

LOCK TABLE
  public."DirectUpload",
  public."DirectUploadReference",
  public."CaseMessageAttachment"
IN ACCESS EXCLUSIVE MODE;

DO $grainline_direct_upload_retirement_preflight$
DECLARE
  direct_upload_state record;
  reference_state record;
  object_key_column record;
  direct_upload_id_column record;
  invalid_case_attachment_count integer;
  invalid_case_reference_count integer;
  invalid_lifecycle_reference_count integer;
BEGIN
  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO direct_upload_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'DirectUpload'
     AND class.relkind = 'r';
  IF NOT FOUND
     OR direct_upload_state.relrowsecurity
     OR direct_upload_state.relforcerowsecurity THEN
    RAISE EXCEPTION
      'DirectUpload retirement requires the compatible pre-activation posture';
  END IF;

  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO reference_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'DirectUploadReference'
     AND class.relkind = 'r';
  IF NOT FOUND
     OR NOT reference_state.relrowsecurity
     OR NOT reference_state.relforcerowsecurity THEN
    RAISE EXCEPTION
      'DirectUploadReference must retain ENABLE plus FORCE before retirement';
  END IF;

  SELECT
    attribute.attnotnull,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type_name
    INTO object_key_column
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CaseMessageAttachment'
     AND attribute.attname = 'objectKey'
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF NOT FOUND
     OR NOT object_key_column.attnotnull
     OR object_key_column.type_name IS DISTINCT FROM 'character varying(500)' THEN
    RAISE EXCEPTION
      'CaseMessageAttachment.objectKey compatibility column drifted';
  END IF;

  SELECT
    attribute.attnotnull,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS type_name
    INTO direct_upload_id_column
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'CaseMessageAttachment'
     AND attribute.attname = 'directUploadId'
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;
  IF NOT FOUND
     OR NOT direct_upload_id_column.attnotnull
     OR direct_upload_id_column.type_name IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION
      'CaseMessageAttachment.directUploadId authority column drifted';
  END IF;

  IF pg_catalog.to_regclass(
       'public."CaseMessageAttachment_objectKey_key"'
     ) IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
          'public."CaseMessageAttachment"'::pg_catalog.regclass
          AND constraint_row.conname =
            'CaseMessageAttachment_objectKey_check'
          AND constraint_row.contype = 'c'
     ) THEN
    RAISE EXCEPTION
      'CaseMessageAttachment objectKey constraints drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_case_attachment_count
    FROM public."CaseMessageAttachment" AS attachment
    LEFT JOIN public."DirectUpload" AS upload
      ON upload.id = attachment."directUploadId"
   WHERE upload.id IS NULL
      OR upload.key IS DISTINCT FROM attachment."objectKey"
      OR upload."userId" IS DISTINCT FROM attachment."uploaderId"
      OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
      OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
      OR upload."publicUrl" IS NOT NULL
      OR upload."contentType" IS DISTINCT FROM attachment."contentType"
      OR upload."expectedSize" IS DISTINCT FROM attachment."byteSize"
      OR upload.status IS DISTINCT FROM 'CLAIMED';
  IF invalid_case_attachment_count <> 0 THEN
    RAISE EXCEPTION
      'CaseMessageAttachment compatibility identity is not exact: %',
      invalid_case_attachment_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_case_reference_count
    FROM (
      SELECT attachment.id
        FROM public."CaseMessageAttachment" AS attachment
        LEFT JOIN public."DirectUploadReference" AS reference
          ON reference."directUploadId" = attachment."directUploadId"
         AND reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
         AND reference."sourceId" = attachment.id
         AND reference."releasedAt" IS NULL
       GROUP BY attachment.id
      HAVING pg_catalog.count(reference.id) <> 1
      UNION ALL
      SELECT reference.id
        FROM public."DirectUploadReference" AS reference
        LEFT JOIN public."CaseMessageAttachment" AS attachment
          ON attachment.id = reference."sourceId"
         AND attachment."directUploadId" = reference."directUploadId"
       WHERE reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
         AND reference."releasedAt" IS NULL
         AND attachment.id IS NULL
    ) AS invalid_case_reference;
  IF invalid_case_reference_count <> 0 THEN
    RAISE EXCEPTION
      'CaseMessageAttachment active reference identity is not exact: %',
      invalid_case_reference_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_lifecycle_reference_count
    FROM public."DirectUpload" AS upload
   WHERE (
       upload.status = 'CLAIMED'
       AND NOT EXISTS (
         SELECT 1
           FROM public."DirectUploadReference" AS reference
          WHERE reference."directUploadId" = upload.id
            AND reference."releasedAt" IS NULL
       )
     )
      OR (
        upload.status <> 'CLAIMED'
        AND EXISTS (
          SELECT 1
            FROM public."DirectUploadReference" AS reference
           WHERE reference."directUploadId" = upload.id
             AND reference."releasedAt" IS NULL
        )
      )
      OR EXISTS (
        SELECT 1
          FROM public."DirectUploadReference" AS reference
         WHERE reference."directUploadId" = upload.id
           AND reference."releasedAt" IS NULL
           AND reference.exclusive IS DISTINCT FROM
             (upload."storageClass" = 'PRIVATE')
      );
  IF invalid_lifecycle_reference_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload active reference/status coherence is incomplete: %',
      invalid_lifecycle_reference_count;
  END IF;
END
$grainline_direct_upload_retirement_preflight$;

ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_userId_fkey";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_endpoint_check";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_key_endpoint_check";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_public_url_key_check";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_endpoint_storage_content_size_check";
ALTER TABLE public."DirectUpload"
  VALIDATE CONSTRAINT "DirectUpload_cleanup_lease_pair_check";

DROP TRIGGER grainline_direct_upload_case_attachment_bind
  ON public."CaseMessageAttachment";

ALTER TABLE public."CaseMessageAttachment"
  DROP CONSTRAINT "CaseMessageAttachment_objectKey_key",
  DROP CONSTRAINT "CaseMessageAttachment_objectKey_check",
  DROP COLUMN "objectKey";

-- The compatible Case-reply function dual-writes objectKey before retirement.
-- Replace it in the same transaction so replies remain valid once the column
-- is absent. CREATE OR REPLACE preserves its already-reviewed EXECUTE ACL.
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
      "contentType",
      "byteSize",
      "createdAt"
    )
    VALUES (
      target_attachment_id,
      target_message_id,
      locked_actor.id,
      upload.id,
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

CREATE OR REPLACE FUNCTION
  public.grainline_direct_upload_case_attachment_bind()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_case_attachment_bind$
DECLARE
  upload record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW."caseMessageId" IS DISTINCT FROM OLD."caseMessageId"
       OR NEW."uploaderId" IS DISTINCT FROM OLD."uploaderId"
       OR NEW."directUploadId" IS DISTINCT FROM OLD."directUploadId"
       OR NEW."contentType" IS DISTINCT FROM OLD."contentType"
       OR NEW."byteSize" IS DISTINCT FROM OLD."byteSize"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     ) THEN
    RAISE EXCEPTION 'CaseMessageAttachment identity fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    candidate."userId",
    candidate.endpoint,
    candidate."storageClass",
    candidate."publicUrl",
    candidate."contentType",
    candidate."expectedSize",
    candidate.status
    INTO upload
    FROM public."DirectUpload" AS candidate
   WHERE candidate.id = NEW."directUploadId"
   FOR UPDATE;

  IF NOT FOUND
     OR upload."userId" IS DISTINCT FROM NEW."uploaderId"
     OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
     OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
     OR upload."publicUrl" IS NOT NULL
     OR upload."contentType" IS DISTINCT FROM NEW."contentType"
     OR upload."expectedSize" IS DISTINCT FROM NEW."byteSize"
     OR upload.status NOT IN ('VERIFIED', 'CLAIMED') THEN
    RAISE EXCEPTION 'CaseMessageAttachment DirectUpload binding is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$grainline_direct_upload_case_attachment_bind$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_case_attachment_bind()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_direct_upload_case_attachment_bind
BEFORE INSERT OR UPDATE
ON public."CaseMessageAttachment"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_case_attachment_bind();

DO $grainline_direct_upload_retirement_postflight$
DECLARE
  unvalidated_constraint_count integer;
  bind_function record;
  case_reply_function record;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
       'public."CaseMessageAttachment"'::pg_catalog.regclass
       AND attribute.attname = 'objectKey'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION
      'CaseMessageAttachment.objectKey was not retired';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unvalidated_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
     'public."DirectUpload"'::pg_catalog.regclass
     AND constraint_row.conname IN (
       'DirectUpload_userId_fkey',
       'DirectUpload_endpoint_check',
       'DirectUpload_key_endpoint_check',
       'DirectUpload_public_url_key_check',
       'DirectUpload_endpoint_storage_content_size_check',
       'DirectUpload_cleanup_lease_pair_check'
     )
     AND NOT constraint_row.convalidated;
  IF unvalidated_constraint_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload legacy constraints remain unvalidated: %',
      unvalidated_constraint_count;
  END IF;

  SELECT
    procedure.prosecdef,
    procedure.proleakproof,
    procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
    pg_catalog.has_function_privilege(
      'grainline_app_runtime', procedure.oid, 'EXECUTE'
    ) AS runtime_execute,
    EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute
    INTO bind_function
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = pg_catalog.to_regprocedure(
     'public.grainline_direct_upload_case_attachment_bind()'
   );
  IF NOT FOUND
     OR NOT bind_function.prosecdef
     OR bind_function.proleakproof
     OR bind_function.proconfig IS DISTINCT FROM
       ARRAY['search_path=pg_catalog']::text[]
     OR bind_function.owner_name IS DISTINCT FROM current_user
     OR bind_function.runtime_execute
     OR bind_function.public_execute THEN
    RAISE EXCEPTION
      'CaseMessageAttachment binding authority drifted after retirement';
  END IF;

  SELECT
    procedure.prosecdef,
    procedure.proleakproof,
    procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
    pg_catalog.has_function_privilege(
      'grainline_app_runtime', procedure.oid, 'EXECUTE'
    ) AS runtime_execute,
    pg_catalog.strpos(
      pg_catalog.pg_get_functiondef(procedure.oid),
      '"objectKey"'
    ) = 0 AS object_key_retired,
    EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute
    INTO case_reply_function
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = pg_catalog.to_regprocedure(
     'public.grainline_case_reply(text,text,text,text[])'
   );
  IF NOT FOUND
     OR NOT case_reply_function.prosecdef
     OR case_reply_function.proleakproof
     OR case_reply_function.proconfig IS DISTINCT FROM
       ARRAY['search_path=pg_catalog']::text[]
     OR case_reply_function.owner_name IS DISTINCT FROM current_user
     OR NOT case_reply_function.runtime_execute
     OR NOT case_reply_function.object_key_retired
     OR case_reply_function.public_execute THEN
    RAISE EXCEPTION
      'Case-reply authority drifted after objectKey retirement';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger
     WHERE trigger.tgrelid =
       'public."CaseMessageAttachment"'::pg_catalog.regclass
       AND trigger.tgname =
         'grainline_direct_upload_case_attachment_bind'
       AND NOT trigger.tgisinternal
       AND trigger.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION
      'CaseMessageAttachment binding trigger is missing after retirement';
  END IF;
END
$grainline_direct_upload_retirement_postflight$;

COMMIT;
