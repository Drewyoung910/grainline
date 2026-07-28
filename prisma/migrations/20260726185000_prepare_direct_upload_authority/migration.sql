-- Compatible DirectUpload fixed-authority preparation.
--
-- This migration grants reviewed operations while retaining the old
-- DirectUpload table grants for the old application during coexistence.
-- DirectUpload RLS activation and table-grant revocation are separate gates.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.direct-upload.rls.activation', 0)
);

DO $grainline_direct_upload_authority_preflight$
DECLARE
  runtime_role record;
  direct_upload_state record;
  reference_state record;
  candidate_function_count integer;
BEGIN
  SELECT rolsuper, rolinherit, rolcanlogin, rolreplication, rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper
     OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION
      'grainline_app_runtime role posture is not DirectUpload-safe';
  END IF;

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
      'DirectUpload must retain pre-activation RLS posture during preparation';
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
    RAISE EXCEPTION 'DirectUploadReference RLS posture is incomplete';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."DirectUpload"',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'DirectUpload preparation requires old-application CRUD compatibility';
  END IF;
  IF pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."DirectUploadReference"',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'DirectUploadReference must remain runtime table-inaccessible';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO candidate_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY (ARRAY[
       'grainline_direct_upload_actor_valid',
       'grainline_direct_upload_utc_now',
       'grainline_direct_upload_record_core',
       'grainline_direct_upload_record_processed_public',
       'grainline_direct_upload_record_presigned_public',
       'grainline_direct_upload_record_private_case',
       'grainline_direct_upload_record_private_message',
       'grainline_direct_upload_verify_public',
       'grainline_direct_upload_owned_lookup',
       'grainline_direct_upload_reference_core',
       'grainline_direct_upload_release_core',
       'grainline_direct_upload_reference_case_attachment',
       'grainline_direct_upload_case_attachment_reference_trigger',
       'grainline_direct_upload_case_attachment_read',
       'grainline_direct_upload_cleanup_lease',
       'grainline_direct_upload_cleanup_complete',
       'grainline_direct_upload_cleanup_fail',
       'grainline_direct_upload_export',
       'grainline_direct_upload_account_public_urls',
       'grainline_direct_upload_release_for_account'
     ]::text[]);
  IF candidate_function_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload authority function names already exist: %',
      candidate_function_count;
  END IF;
END
$grainline_direct_upload_authority_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_actor_valid(
  p_user_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_actor_valid$
  SELECT
    p_user_id IS NOT NULL
    AND p_user_id ~ '^[A-Za-z0-9._:-]{1,128}$'
    AND EXISTS (
      SELECT 1
        FROM public."User" AS actor
       WHERE actor.id = p_user_id
         AND actor.banned = false
         AND actor."deletedAt" IS NULL
    );
$grainline_direct_upload_actor_valid$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_actor_valid(text)
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_utc_now()
RETURNS timestamp(3)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_direct_upload_utc_now$
  SELECT pg_catalog.timezone(
    'UTC',
    pg_catalog.clock_timestamp()
  )::timestamp(3);
$grainline_direct_upload_utc_now$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_utc_now()
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_record_core(
  p_user_id text,
  p_key text,
  p_endpoint text,
  p_public_url text,
  p_content_type text,
  p_expected_size integer,
  p_storage_class text,
  p_status text,
  p_context_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_record_core$
DECLARE
  recorded_at timestamp(3);
  lifecycle_id text;
  existing public."DirectUpload"%ROWTYPE;
  actor_role public."Role";
  actor_key_segment text;
  case_record record;
BEGIN
  IF NOT public.grainline_direct_upload_actor_valid(p_user_id) THEN
    RAISE EXCEPTION 'DirectUpload actor is invalid' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL
     OR p_key = ''
     OR pg_catalog.char_length(p_key) > 500
     OR p_endpoint IS NULL
     OR p_endpoint = ''
     OR pg_catalog.char_length(p_endpoint) > 40
     OR p_content_type IS NULL
     OR p_content_type = ''
     OR pg_catalog.char_length(p_content_type) > 100
     OR p_expected_size IS NULL
     OR p_expected_size <= 0
     OR p_storage_class IS NULL
     OR p_storage_class NOT IN ('PUBLIC', 'PRIVATE')
     OR p_status IS NULL
     OR p_status NOT IN ('PRESIGNED', 'VERIFIED') THEN
    RAISE EXCEPTION 'DirectUpload record input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    actor.role,
    pg_catalog.left(
      pg_catalog.regexp_replace(
        actor."clerkId",
        '[^A-Za-z0-9_-]',
        '_',
        'g'
      ),
      128
    )
    INTO actor_role, actor_key_segment
    FROM public."User" AS actor
   WHERE actor.id = p_user_id;
  IF actor_key_segment IS NULL
     OR actor_key_segment = ''
     OR pg_catalog.split_part(p_key, '/', 1) IS DISTINCT FROM p_endpoint
     OR pg_catalog.split_part(p_key, '/', 2) IS DISTINCT FROM actor_key_segment
     OR p_key ~ '[[:cntrl:]]'
     OR position('..' IN p_key) > 0 THEN
    RAISE EXCEPTION 'DirectUpload key is not scoped to the actor and endpoint'
      USING ERRCODE = '42501';
  END IF;

  IF p_storage_class = 'PUBLIC' THEN
    IF p_context_id IS NOT NULL
       OR p_public_url IS NULL
       OR p_public_url = ''
       OR pg_catalog.char_length(p_public_url) > 2048
       OR pg_catalog.split_part(p_key, '/', 3) = ''
       OR pg_catalog.split_part(p_key, '/', 4) <> '' THEN
      RAISE EXCEPTION 'public DirectUpload metadata is invalid'
        USING ERRCODE = '22023';
    END IF;
    IF p_status = 'PRESIGNED'
       AND p_endpoint NOT IN ('listingVideo', 'messageFile', 'messageAny') THEN
      RAISE EXCEPTION 'DirectUpload endpoint cannot be presigned'
        USING ERRCODE = '22023';
    END IF;
    IF p_endpoint IN (
         'listingImage',
         'listingVideo',
         'bannerImage',
         'galleryImage'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."SellerProfile" AS seller
          WHERE seller."userId" = p_user_id
       ) THEN
      RAISE EXCEPTION 'seller upload requires a seller profile'
        USING ERRCODE = '42501';
    END IF;
    IF p_endpoint = 'blogImage'
       AND actor_role NOT IN (
         'EMPLOYEE'::public."Role",
         'ADMIN'::public."Role"
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."SellerProfile" AS seller
          WHERE seller."userId" = p_user_id
       ) THEN
      RAISE EXCEPTION 'blog upload requires author authority'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF p_public_url IS NOT NULL
       OR p_status IS DISTINCT FROM 'VERIFIED'
       OR p_context_id IS NULL
       OR p_context_id = ''
       OR pg_catalog.char_length(p_context_id) > 191 THEN
      RAISE EXCEPTION 'private DirectUpload metadata is invalid'
        USING ERRCODE = '22023';
    END IF;

    IF p_endpoint = 'caseEvidenceImage' THEN
      IF pg_catalog.split_part(p_key, '/', 1) <> 'caseEvidenceImage'
         OR pg_catalog.split_part(p_key, '/', 3) <> p_context_id
         OR pg_catalog.split_part(p_key, '/', 4) = ''
         OR pg_catalog.split_part(p_key, '/', 5) <> '' THEN
        RAISE EXCEPTION 'private Case key is not scoped to the Case'
          USING ERRCODE = '22023';
      END IF;

      SELECT
        case_row."buyerId",
        case_row."sellerId",
        case_row.status::text AS status
        INTO case_record
        FROM public."Case" AS case_row
       WHERE case_row.id = p_context_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'private Case upload target is missing'
          USING ERRCODE = '23503';
      END IF;
      IF p_user_id IN (case_record."buyerId", case_record."sellerId") THEN
        IF case_record.status NOT IN (
             'OPEN',
             'IN_DISCUSSION',
             'PENDING_CLOSE'
           ) THEN
          RAISE EXCEPTION 'private Case upload is closed'
            USING ERRCODE = '42501';
        END IF;
      ELSIF actor_role IN (
          'EMPLOYEE'::public."Role",
          'ADMIN'::public."Role"
        ) THEN
        IF case_record.status NOT IN (
             'OPEN',
             'IN_DISCUSSION',
             'PENDING_CLOSE',
             'UNDER_REVIEW'
           ) THEN
          RAISE EXCEPTION 'private Case upload is closed'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'private Case upload actor is not authorized'
          USING ERRCODE = '42501';
      END IF;
    ELSIF p_endpoint = 'messagePrivateImage' THEN
      IF pg_catalog.split_part(p_key, '/', 1) <> 'messagePrivateImage'
         OR pg_catalog.split_part(p_key, '/', 3) <> p_context_id
         OR pg_catalog.split_part(p_key, '/', 4) = ''
         OR pg_catalog.split_part(p_key, '/', 5) <> ''
         OR NOT EXISTS (
           SELECT 1
             FROM public."Conversation" AS conversation
            WHERE conversation.id = p_context_id
              AND p_user_id IN (
                    conversation."userAId",
                    conversation."userBId"
                  )
         ) THEN
        RAISE EXCEPTION 'private Message upload target is invalid'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'unknown private DirectUpload endpoint'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  recorded_at := public.grainline_direct_upload_utc_now();
  lifecycle_id := pg_catalog.gen_random_uuid()::text;

  INSERT INTO public."DirectUpload" (
    id,
    key,
    endpoint,
    "userId",
    "publicUrl",
    "storageClass",
    "contentType",
    "expectedSize",
    status,
    "cleanupAfter",
    "verifiedAt",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    lifecycle_id,
    p_key,
    p_endpoint,
    p_user_id,
    p_public_url,
    p_storage_class,
    p_content_type,
    p_expected_size,
    p_status,
    recorded_at + CASE p_status
      WHEN 'PRESIGNED' THEN interval '2 hours'
      ELSE interval '24 hours'
    END,
    CASE WHEN p_status = 'VERIFIED' THEN recorded_at ELSE NULL END,
    recorded_at,
    recorded_at
  )
  ON CONFLICT (key) DO NOTHING
  RETURNING id INTO lifecycle_id;

  IF lifecycle_id IS NOT NULL THEN
    RETURN lifecycle_id;
  END IF;

  SELECT upload.*
    INTO existing
    FROM public."DirectUpload" AS upload
   WHERE upload.key = p_key
   FOR UPDATE;
  IF NOT FOUND
     OR existing."userId" IS DISTINCT FROM p_user_id
     OR existing.endpoint IS DISTINCT FROM p_endpoint
     OR existing."publicUrl" IS DISTINCT FROM p_public_url
     OR existing."storageClass" IS DISTINCT FROM p_storage_class
     OR existing."contentType" IS DISTINCT FROM p_content_type
     OR existing."expectedSize" IS DISTINCT FROM p_expected_size
     OR existing.status IN ('DELETING', 'DELETED', 'DELETE_FAILED') THEN
    RAISE EXCEPTION 'DirectUpload key is already bound to different metadata'
      USING ERRCODE = '23505';
  END IF;

  RETURN existing.id;
END;
$grainline_direct_upload_record_core$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_core(
    text, text, text, text, text, integer, text, text, text
  )
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_record_processed_public(
  p_user_id text,
  p_key text,
  p_endpoint text,
  p_public_url text,
  p_content_type text,
  p_expected_size integer
)
RETURNS text
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_record_processed_public$
  SELECT public.grainline_direct_upload_record_core(
    p_user_id,
    p_key,
    p_endpoint,
    p_public_url,
    p_content_type,
    p_expected_size,
    'PUBLIC',
    'VERIFIED',
    NULL
  );
$grainline_direct_upload_record_processed_public$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_record_presigned_public(
  p_user_id text,
  p_key text,
  p_endpoint text,
  p_public_url text,
  p_content_type text,
  p_expected_size integer
)
RETURNS text
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_record_presigned_public$
  SELECT public.grainline_direct_upload_record_core(
    p_user_id,
    p_key,
    p_endpoint,
    p_public_url,
    p_content_type,
    p_expected_size,
    'PUBLIC',
    'PRESIGNED',
    NULL
  );
$grainline_direct_upload_record_presigned_public$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_record_private_case(
  p_user_id text,
  p_case_id text,
  p_key text,
  p_content_type text,
  p_expected_size integer
)
RETURNS text
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_record_private_case$
  SELECT public.grainline_direct_upload_record_core(
    p_user_id,
    p_key,
    'caseEvidenceImage',
    NULL,
    p_content_type,
    p_expected_size,
    'PRIVATE',
    'VERIFIED',
    p_case_id
  );
$grainline_direct_upload_record_private_case$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_record_private_message(
  p_user_id text,
  p_conversation_id text,
  p_key text,
  p_content_type text,
  p_expected_size integer
)
RETURNS text
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_record_private_message$
  SELECT public.grainline_direct_upload_record_core(
    p_user_id,
    p_key,
    'messagePrivateImage',
    NULL,
    p_content_type,
    p_expected_size,
    'PRIVATE',
    'VERIFIED',
    p_conversation_id
  );
$grainline_direct_upload_record_private_message$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_verify_public(
  p_user_id text,
  p_key text,
  p_endpoint text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_verify_public$
DECLARE
  verified_at timestamp(3);
  updated_count integer;
BEGIN
  IF NOT public.grainline_direct_upload_actor_valid(p_user_id)
     OR p_key IS NULL
     OR p_key = ''
     OR pg_catalog.char_length(p_key) > 500
     OR p_endpoint NOT IN ('listingVideo', 'messageFile', 'messageAny') THEN
    RETURN false;
  END IF;

  verified_at := public.grainline_direct_upload_utc_now();
  UPDATE public."DirectUpload" AS upload
     SET status = 'VERIFIED',
         "verifiedAt" = COALESCE(upload."verifiedAt", verified_at),
         "cleanupAfter" = verified_at + interval '24 hours',
         "lastError" = NULL,
         "updatedAt" = verified_at
   WHERE upload.key = p_key
     AND upload.endpoint = p_endpoint
     AND upload."userId" = p_user_id
     AND upload."storageClass" = 'PUBLIC'
     AND upload.status IN ('PRESIGNED', 'VERIFIED');
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$grainline_direct_upload_verify_public$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_owned_lookup(
  p_user_id text,
  p_key text
)
RETURNS TABLE (
  id text,
  endpoint text,
  "publicUrl" text,
  "storageClass" text,
  "contentType" text,
  "expectedSize" integer,
  status text
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_owned_lookup$
  SELECT
    upload.id,
    upload.endpoint::text,
    upload."publicUrl"::text,
    upload."storageClass"::text,
    upload."contentType"::text,
    upload."expectedSize",
    upload.status::text
    FROM public."DirectUpload" AS upload
   WHERE public.grainline_direct_upload_actor_valid(p_user_id)
     AND p_key IS NOT NULL
     AND p_key <> ''
     AND pg_catalog.char_length(p_key) <= 500
     AND upload.key = p_key
     AND upload."userId" = p_user_id;
$grainline_direct_upload_owned_lookup$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_reference_core(
  p_direct_upload_id text,
  p_source_type text,
  p_source_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_reference_core$
DECLARE
  lifecycle record;
  referenced_at timestamp(3);
BEGIN
  IF p_direct_upload_id IS NULL
     OR p_direct_upload_id = ''
     OR pg_catalog.char_length(p_direct_upload_id) > 191
     OR p_source_type IS NULL
     OR p_source_type = ''
     OR pg_catalog.char_length(p_source_type) > 50
     OR p_source_id IS NULL
     OR p_source_id = ''
     OR pg_catalog.char_length(p_source_id) > 191 THEN
    RAISE EXCEPTION 'DirectUpload reference input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    upload.status,
    upload."storageClass",
    upload."claimedByType",
    upload."claimedById"
    INTO lifecycle
    FROM public."DirectUpload" AS upload
   WHERE upload.id = p_direct_upload_id
   FOR UPDATE;
  IF NOT FOUND OR lifecycle.status NOT IN ('VERIFIED', 'CLAIMED') THEN
    RAISE EXCEPTION 'DirectUpload is not claimable' USING ERRCODE = '23514';
  END IF;

  referenced_at := public.grainline_direct_upload_utc_now();
  INSERT INTO public."DirectUploadReference" (
    id,
    "directUploadId",
    "sourceType",
    "sourceId",
    exclusive,
    "createdAt"
  )
  VALUES (
    pg_catalog.gen_random_uuid()::text,
    p_direct_upload_id,
    p_source_type,
    p_source_id,
    lifecycle."storageClass" = 'PRIVATE',
    referenced_at
  )
  ON CONFLICT (
    "directUploadId",
    "sourceType",
    "sourceId"
  ) WHERE "releasedAt" IS NULL
  DO NOTHING;

  UPDATE public."DirectUpload" AS upload
     SET status = 'CLAIMED',
         "claimedAt" = COALESCE(upload."claimedAt", referenced_at),
         "claimedByType" = COALESCE(upload."claimedByType", p_source_type),
         "claimedById" = COALESCE(upload."claimedById", p_source_id),
         "cleanupAfter" = NULL,
         "cleanupLeaseId" = NULL,
         "cleanupLeaseAt" = NULL,
         "lastError" = NULL,
         "updatedAt" = referenced_at
   WHERE upload.id = p_direct_upload_id;

  RETURN true;
END;
$grainline_direct_upload_reference_core$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_reference_core(text, text, text)
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_release_core(
  p_direct_upload_id text,
  p_source_type text,
  p_source_id text,
  p_release_reason text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_release_core$
DECLARE
  released_at timestamp(3);
  released_count integer;
BEGIN
  IF p_release_reason IS NULL
     OR p_release_reason = ''
     OR pg_catalog.char_length(p_release_reason) > 200
     OR p_release_reason !~ '^[A-Z0-9_:-]{1,200}$' THEN
    RAISE EXCEPTION 'DirectUpload release reason is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."DirectUpload" AS upload
   WHERE upload.id = p_direct_upload_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  released_at := public.grainline_direct_upload_utc_now();
  UPDATE public."DirectUploadReference" AS reference
     SET "releasedAt" = released_at,
         "releaseReason" = p_release_reason
   WHERE reference."directUploadId" = p_direct_upload_id
     AND reference."sourceType" = p_source_type
     AND reference."sourceId" = p_source_id
     AND reference."releasedAt" IS NULL;
  GET DIAGNOSTICS released_count = ROW_COUNT;

  IF released_count = 1
     AND NOT EXISTS (
       SELECT 1
         FROM public."DirectUploadReference" AS active_reference
        WHERE active_reference."directUploadId" = p_direct_upload_id
          AND active_reference."releasedAt" IS NULL
     ) THEN
    UPDATE public."DirectUpload" AS upload
       SET status = 'VERIFIED',
           "claimedAt" = NULL,
           "claimedByType" = NULL,
           "claimedById" = NULL,
           "cleanupAfter" = released_at,
           "cleanupLeaseId" = NULL,
           "cleanupLeaseAt" = NULL,
           "lastError" = NULL,
           "updatedAt" = released_at
     WHERE upload.id = p_direct_upload_id
       AND upload.status = 'CLAIMED';
  END IF;

  RETURN released_count = 1;
END;
$grainline_direct_upload_release_core$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_release_core(text, text, text, text)
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_reference_case_attachment(
  p_user_id text,
  p_attachment_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_reference_case_attachment$
DECLARE
  candidate record;
BEGIN
  IF NOT public.grainline_direct_upload_actor_valid(p_user_id)
     OR p_attachment_id IS NULL
     OR p_attachment_id = ''
     OR pg_catalog.char_length(p_attachment_id) > 191 THEN
    RETURN false;
  END IF;

  SELECT
    attachment."directUploadId",
    attachment."uploaderId",
    attachment."contentType",
    attachment."byteSize",
    message."authorId",
    case_row."buyerId",
    case_row."sellerId",
    actor.role,
    upload."userId" AS upload_user_id,
    upload.endpoint,
    upload."storageClass",
    upload."contentType" AS upload_content_type,
    upload."expectedSize",
    upload.status
    INTO candidate
    FROM public."CaseMessageAttachment" AS attachment
    JOIN public."CaseMessage" AS message
      ON message.id = attachment."caseMessageId"
    JOIN public."Case" AS case_row
      ON case_row.id = message."caseId"
    JOIN public."User" AS actor
      ON actor.id = p_user_id
    JOIN public."DirectUpload" AS upload
      ON upload.id = attachment."directUploadId"
   WHERE attachment.id = p_attachment_id
   FOR UPDATE OF attachment, message, case_row, upload;
  IF NOT FOUND
     OR candidate."uploaderId" IS DISTINCT FROM p_user_id
     OR candidate."authorId" IS DISTINCT FROM p_user_id
     OR (
       p_user_id IS DISTINCT FROM candidate."buyerId"
       AND p_user_id IS DISTINCT FROM candidate."sellerId"
       AND candidate.role NOT IN (
         'EMPLOYEE'::public."Role",
         'ADMIN'::public."Role"
       )
     )
     OR candidate.upload_user_id IS DISTINCT FROM p_user_id
     OR candidate.endpoint IS DISTINCT FROM 'caseEvidenceImage'
     OR candidate."storageClass" IS DISTINCT FROM 'PRIVATE'
     OR candidate.upload_content_type IS DISTINCT FROM candidate."contentType"
     OR candidate."expectedSize" IS DISTINCT FROM candidate."byteSize"
     OR candidate.status NOT IN ('VERIFIED', 'CLAIMED') THEN
    RETURN false;
  END IF;

  RETURN public.grainline_direct_upload_reference_core(
    candidate."directUploadId",
    'CASE_MESSAGE_ATTACHMENT',
    p_attachment_id
  );
END;
$grainline_direct_upload_reference_case_attachment$;

CREATE OR REPLACE FUNCTION
  public.grainline_direct_upload_case_attachment_reference_trigger()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_case_attachment_reference_trigger$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT public.grainline_direct_upload_reference_case_attachment(
      NEW."uploaderId",
      NEW.id
    ) THEN
      RAISE EXCEPTION
        'CaseMessageAttachment reference could not be established'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.grainline_direct_upload_release_core(
      OLD."directUploadId",
      'CASE_MESSAGE_ATTACHMENT',
      OLD.id,
      'SOURCE_DELETED'
    );
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'Unexpected CaseMessageAttachment reference trigger operation: %',
    TG_OP
    USING ERRCODE = '0A000';
END;
$grainline_direct_upload_case_attachment_reference_trigger$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_case_attachment_reference_trigger()
  FROM PUBLIC, grainline_app_runtime;

CREATE CONSTRAINT TRIGGER
  grainline_direct_upload_reference_case_attachment_insert
AFTER INSERT ON public."CaseMessageAttachment"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_case_attachment_reference_trigger();

CREATE TRIGGER grainline_direct_upload_release_case_attachment_delete
BEFORE DELETE ON public."CaseMessageAttachment"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_case_attachment_reference_trigger();

DO $grainline_direct_upload_case_attachment_reference_backfill$
DECLARE
  attachment record;
BEGIN
  FOR attachment IN
    SELECT row.id, row."uploaderId"
      FROM public."CaseMessageAttachment" AS row
     ORDER BY row.id
  LOOP
    IF NOT public.grainline_direct_upload_reference_case_attachment(
      attachment."uploaderId",
      attachment.id
    ) THEN
      RAISE EXCEPTION
        'Existing CaseMessageAttachment reference could not be established: %',
        attachment.id;
    END IF;
  END LOOP;
END
$grainline_direct_upload_case_attachment_reference_backfill$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_case_attachment_read(
  p_user_id text,
  p_case_id text,
  p_attachment_id text
)
RETURNS TABLE (
  key text,
  "contentType" text
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_case_attachment_read$
  SELECT
    upload.key::text,
    attachment."contentType"::text
    FROM public."CaseMessageAttachment" AS attachment
    JOIN public."CaseMessage" AS message
      ON message.id = attachment."caseMessageId"
    JOIN public."Case" AS case_row
      ON case_row.id = message."caseId"
    JOIN public."User" AS actor
      ON actor.id = p_user_id
    JOIN public."DirectUpload" AS upload
      ON upload.id = attachment."directUploadId"
    JOIN public."DirectUploadReference" AS reference
      ON reference."directUploadId" = upload.id
     AND reference."sourceType" = 'CASE_MESSAGE_ATTACHMENT'
     AND reference."sourceId" = attachment.id
     AND reference."releasedAt" IS NULL
   WHERE public.grainline_direct_upload_actor_valid(p_user_id)
     AND case_row.id = p_case_id
     AND attachment.id = p_attachment_id
     AND upload.endpoint = 'caseEvidenceImage'
     AND upload."storageClass" = 'PRIVATE'
     AND upload.status = 'CLAIMED'
     AND (
       p_user_id IN (case_row."buyerId", case_row."sellerId")
       OR actor.role IN (
            'EMPLOYEE'::public."Role",
            'ADMIN'::public."Role"
          )
     );
$grainline_direct_upload_case_attachment_read$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_cleanup_lease(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id text,
  key text,
  "storageClass" text,
  "leaseId" text
)
LANGUAGE sql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_cleanup_lease$
  WITH clock AS MATERIALIZED (
    SELECT public.grainline_direct_upload_utc_now() AS now
  ), candidates AS MATERIALIZED (
    SELECT upload.id
      FROM public."DirectUpload" AS upload
      CROSS JOIN clock
     WHERE upload.status IN (
             'PRESIGNED',
             'VERIFIED',
             'DELETING',
             'DELETE_FAILED'
           )
       AND upload."cleanupAfter" <= clock.now
       AND NOT EXISTS (
         SELECT 1
           FROM public."DirectUploadReference" AS reference
          WHERE reference."directUploadId" = upload.id
            AND reference."releasedAt" IS NULL
       )
     ORDER BY upload."cleanupAfter" ASC, upload.id ASC
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 20))
     FOR UPDATE OF upload SKIP LOCKED
  ), leased AS (
    UPDATE public."DirectUpload" AS upload
       SET status = 'DELETING',
           attempts = upload.attempts + 1,
           "cleanupLeaseId" = pg_catalog.gen_random_uuid()::text,
           "cleanupLeaseAt" = clock.now,
           "cleanupAfter" = clock.now + interval '30 minutes',
           "lastError" = NULL,
           "updatedAt" = clock.now
      FROM candidates, clock
     WHERE upload.id = candidates.id
    RETURNING
      upload.id,
      upload.key,
      upload."storageClass",
      upload."cleanupLeaseId"
  )
  SELECT
    leased.id,
    leased.key::text,
    leased."storageClass"::text,
    leased."cleanupLeaseId"::text
    FROM leased
   ORDER BY leased.id;
$grainline_direct_upload_cleanup_lease$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_cleanup_complete(
  p_id text,
  p_lease_id text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_cleanup_complete$
DECLARE
  completed_count integer;
  completed_at timestamp(3);
BEGIN
  IF p_id IS NULL
     OR p_id = ''
     OR pg_catalog.char_length(p_id) > 191
     OR p_lease_id IS NULL
     OR p_lease_id = ''
     OR pg_catalog.char_length(p_lease_id) > 64 THEN
    RETURN false;
  END IF;

  completed_at := public.grainline_direct_upload_utc_now();
  UPDATE public."DirectUpload" AS upload
     SET status = 'DELETED',
         "deletedAt" = completed_at,
         "cleanupAfter" = NULL,
         "cleanupLeaseId" = NULL,
         "cleanupLeaseAt" = NULL,
         "lastError" = NULL,
         "updatedAt" = completed_at
   WHERE upload.id = p_id
     AND upload.status = 'DELETING'
     AND upload."cleanupLeaseId" = p_lease_id;
  GET DIAGNOSTICS completed_count = ROW_COUNT;
  RETURN completed_count = 1;
END;
$grainline_direct_upload_cleanup_complete$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_cleanup_fail(
  p_id text,
  p_lease_id text,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_cleanup_fail$
DECLARE
  failed_count integer;
  failed_at timestamp(3);
  bounded_error text;
BEGIN
  IF p_id IS NULL
     OR p_id = ''
     OR pg_catalog.char_length(p_id) > 191
     OR p_lease_id IS NULL
     OR p_lease_id = ''
     OR pg_catalog.char_length(p_lease_id) > 64 THEN
    RETURN false;
  END IF;

  failed_at := public.grainline_direct_upload_utc_now();
  bounded_error := pg_catalog.left(
    pg_catalog.regexp_replace(
      COALESCE(p_error, 'Unknown deletion failure'),
      '[[:cntrl:]]',
      ' ',
      'g'
    ),
    1000
  );
  UPDATE public."DirectUpload" AS upload
     SET status = 'DELETE_FAILED',
         "cleanupAfter" = failed_at + interval '30 minutes',
         "cleanupLeaseId" = NULL,
         "cleanupLeaseAt" = NULL,
         "lastError" = bounded_error,
         "updatedAt" = failed_at
   WHERE upload.id = p_id
     AND upload.status = 'DELETING'
     AND upload."cleanupLeaseId" = p_lease_id;
  GET DIAGNOSTICS failed_count = ROW_COUNT;
  RETURN failed_count = 1;
END;
$grainline_direct_upload_cleanup_fail$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_export(
  p_user_id text
)
RETURNS TABLE (
  id text,
  endpoint text,
  "storageClass" text,
  "contentType" text,
  "expectedSize" integer,
  status text,
  "cleanupAfter" timestamp(3),
  "verifiedAt" timestamp(3),
  "claimedAt" timestamp(3),
  "deletedAt" timestamp(3),
  attempts integer,
  "createdAt" timestamp(3),
  "updatedAt" timestamp(3)
)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_export$
  SELECT
    upload.id,
    upload.endpoint::text,
    upload."storageClass"::text,
    upload."contentType"::text,
    upload."expectedSize",
    upload.status::text,
    upload."cleanupAfter",
    upload."verifiedAt",
    upload."claimedAt",
    upload."deletedAt",
    upload.attempts,
    upload."createdAt",
    upload."updatedAt"
    FROM public."DirectUpload" AS upload
   WHERE public.grainline_direct_upload_actor_valid(p_user_id)
     AND upload."userId" = p_user_id
   ORDER BY upload."createdAt" DESC, upload.id DESC;
$grainline_direct_upload_export$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_account_public_urls(
  p_user_id text
)
RETURNS TABLE ("publicUrl" text)
LANGUAGE sql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_account_public_urls$
  SELECT upload."publicUrl"::text
    FROM public."DirectUpload" AS upload
   WHERE p_user_id IS NOT NULL
     AND p_user_id ~ '^[A-Za-z0-9._:-]{1,128}$'
     AND EXISTS (
       SELECT 1
         FROM public."User" AS account_actor
        WHERE account_actor.id = p_user_id
          AND account_actor."deletedAt" IS NULL
     )
     AND upload."userId" = p_user_id
     AND upload."storageClass" = 'PUBLIC'
     AND upload."publicUrl" IS NOT NULL
   ORDER BY upload.id;
$grainline_direct_upload_account_public_urls$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_release_for_account(
  p_user_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_release_for_account$
DECLARE
  released_at timestamp(3);
  released_count integer;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS account_actor
        WHERE account_actor.id = p_user_id
          AND account_actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'DirectUpload account actor is invalid'
      USING ERRCODE = '42501';
  END IF;

  released_at := public.grainline_direct_upload_utc_now();
  UPDATE public."DirectUploadReference" AS reference
     SET "releasedAt" = released_at,
         "releaseReason" = 'ACCOUNT_DELETION'
    FROM public."DirectUpload" AS upload
   WHERE upload.id = reference."directUploadId"
     AND upload."userId" = p_user_id
     AND upload."storageClass" = 'PUBLIC'
     AND reference."releasedAt" IS NULL;
  GET DIAGNOSTICS released_count = ROW_COUNT;

  UPDATE public."DirectUpload" AS upload
     SET status = CASE
           WHEN upload.status = 'CLAIMED' THEN 'VERIFIED'
           ELSE upload.status
         END,
         "claimedAt" = CASE
           WHEN upload.status = 'CLAIMED' THEN NULL
           ELSE upload."claimedAt"
         END,
         "claimedByType" = CASE
           WHEN upload.status = 'CLAIMED' THEN NULL
           ELSE upload."claimedByType"
         END,
         "claimedById" = CASE
           WHEN upload.status = 'CLAIMED' THEN NULL
           ELSE upload."claimedById"
         END,
         "cleanupAfter" = CASE
           WHEN upload.status IN (
             'PRESIGNED',
             'VERIFIED',
             'CLAIMED',
             'DELETE_FAILED'
           ) THEN released_at
           ELSE upload."cleanupAfter"
         END,
         "lastError" = CASE
           WHEN upload.status IN (
             'PRESIGNED',
             'VERIFIED',
             'CLAIMED',
             'DELETE_FAILED'
           ) THEN NULL
           ELSE upload."lastError"
         END,
         "updatedAt" = released_at
   WHERE upload."userId" = p_user_id
     AND upload."storageClass" = 'PUBLIC'
     AND NOT EXISTS (
       SELECT 1
         FROM public."DirectUploadReference" AS active_reference
        WHERE active_reference."directUploadId" = upload.id
          AND active_reference."releasedAt" IS NULL
     );

  RETURN released_count;
END;
$grainline_direct_upload_release_for_account$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_processed_public(
    text, text, text, text, text, integer
  )
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_presigned_public(
    text, text, text, text, text, integer
  )
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_private_case(
    text, text, text, text, integer
  )
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_private_message(
    text, text, text, text, integer
  )
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_verify_public(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_owned_lookup(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_reference_case_attachment(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_case_attachment_reference_trigger()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_case_attachment_read(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_cleanup_lease(integer)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_cleanup_complete(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_cleanup_fail(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_export(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_account_public_urls(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_release_for_account(text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_record_processed_public(
    text, text, text, text, text, integer
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_record_presigned_public(
    text, text, text, text, text, integer
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_record_private_case(
    text, text, text, text, integer
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_record_private_message(
    text, text, text, text, integer
  )
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_verify_public(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_owned_lookup(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_reference_case_attachment(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_case_attachment_read(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_cleanup_lease(integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_cleanup_complete(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_cleanup_fail(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_export(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_account_public_urls(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_release_for_account(text)
  TO grainline_app_runtime;

DO $grainline_direct_upload_authority_postflight$
DECLARE
  runtime_grant_count integer;
  public_grant_count integer;
  private_core_grant_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO runtime_grant_count
    FROM information_schema.routine_privileges AS privilege
   WHERE privilege.routine_schema = 'public'
     AND privilege.grantee = 'grainline_app_runtime'
     AND privilege.privilege_type = 'EXECUTE'
     AND privilege.routine_name = ANY (ARRAY[
       'grainline_direct_upload_record_processed_public',
       'grainline_direct_upload_record_presigned_public',
       'grainline_direct_upload_record_private_case',
       'grainline_direct_upload_record_private_message',
       'grainline_direct_upload_verify_public',
       'grainline_direct_upload_owned_lookup',
       'grainline_direct_upload_reference_case_attachment',
       'grainline_direct_upload_case_attachment_read',
       'grainline_direct_upload_cleanup_lease',
       'grainline_direct_upload_cleanup_complete',
       'grainline_direct_upload_cleanup_fail',
       'grainline_direct_upload_export',
       'grainline_direct_upload_account_public_urls',
       'grainline_direct_upload_release_for_account'
     ]::text[]);
  IF runtime_grant_count <> 14 THEN
    RAISE EXCEPTION
      'DirectUpload runtime function grant catalog is incomplete: %',
      runtime_grant_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO public_grant_count
    FROM information_schema.routine_privileges AS privilege
   WHERE privilege.routine_schema = 'public'
     AND privilege.grantee = 'PUBLIC'
     AND privilege.privilege_type = 'EXECUTE'
     AND privilege.routine_name LIKE 'grainline_direct_upload_%';
  IF public_grant_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload functions must not be PUBLIC-executable: %',
      public_grant_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO private_core_grant_count
    FROM information_schema.routine_privileges AS privilege
   WHERE privilege.routine_schema = 'public'
     AND privilege.grantee = 'grainline_app_runtime'
     AND privilege.privilege_type = 'EXECUTE'
     AND privilege.routine_name IN (
       'grainline_direct_upload_actor_valid',
       'grainline_direct_upload_utc_now',
       'grainline_direct_upload_record_core',
       'grainline_direct_upload_reference_core',
       'grainline_direct_upload_release_core',
       'grainline_direct_upload_case_attachment_reference_trigger'
     );
  IF private_core_grant_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload private cores must remain runtime-inaccessible';
  END IF;
END
$grainline_direct_upload_authority_postflight$;

COMMIT;
