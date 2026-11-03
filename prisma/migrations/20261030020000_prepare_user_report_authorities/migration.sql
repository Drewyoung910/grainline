BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $grainline_user_report_preflight$
DECLARE
  table_oid oid;
BEGIN
  IF pg_catalog.to_regrole('grainline_app_runtime') IS NULL
     OR pg_catalog.to_regrole('grainline_staff_read_runtime') IS NULL THEN
    RAISE EXCEPTION 'UserReport runtime roles are missing';
  END IF;

  SELECT class.oid
    INTO table_oid
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'UserReport'
     AND class.relkind = 'r';
  IF table_oid IS NULL THEN
    RAISE EXCEPTION 'public.UserReport is missing';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'UserReport must remain in predecessor RLS posture during preparation';
  END IF;
  IF NOT pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'SELECT')
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'INSERT')
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'UPDATE')
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', table_oid, 'DELETE') THEN
    RAISE EXCEPTION 'UserReport predecessor grants drifted';
  END IF;
  IF (
    SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attnum)
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY[
    'id', 'reporterId', 'reportedId', 'reason', 'details', 'resolved',
    'createdAt', 'targetId', 'targetType', 'resolvedAt', 'resolvedById',
    'resolutionNote'
  ]::text[] THEN
    RAISE EXCEPTION 'UserReport columns drifted';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.grainline_seller_public_report_target(text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_account_deletion_claim_user(text,bigint,uuid)'
     ) IS NULL THEN
    RAISE EXCEPTION 'UserReport prerequisite authorities are missing';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = ANY(ARRAY[
         'grainline_user_report_submit',
         'grainline_user_report_owner_submitted_export',
         'grainline_user_report_owner_received_export',
         'grainline_user_report_staff_open_count',
         'grainline_user_report_staff_open_page',
         'grainline_user_report_staff_top_reporters',
         'grainline_user_report_staff_resolve',
         'grainline_user_report_account_deletion_redact'
       ]::text[])
  ) THEN
    RAISE EXCEPTION 'UserReport authority name collides with an installed function';
  END IF;
END
$grainline_user_report_preflight$;

ALTER TABLE public."UserReport"
  ADD COLUMN "internalResolutionNote" varchar(1000);

CREATE FUNCTION public.grainline_user_report_submit(
  p_report_id text,
  p_reported_user_id text,
  p_reason text,
  p_details text,
  p_target_type text,
  p_target_id text
)
RETURNS TABLE (
  "reportId" text,
  "reportedId" text,
  "targetType" text,
  "targetId" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_report_submit$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  target_valid boolean := false;
  locked_user_count integer := 0;
BEGIN
  IF actor_id IS NULL
     OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_report_id IS NULL
     OR p_report_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_reported_user_id IS NULL
     OR p_reported_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_reported_user_id = actor_id
     OR p_reason IS NULL
     OR p_reason NOT IN (
       'SPAM', 'HARASSMENT', 'FAKE_LISTING', 'INAPPROPRIATE', 'OTHER'
     )
     OR (p_details IS NOT NULL AND pg_catalog.char_length(p_details) > 500)
     OR (p_target_type IS NULL) <> (p_target_id IS NULL)
     OR (
       p_target_type IS NOT NULL
       AND p_target_type NOT IN (
         'LISTING', 'MESSAGE_THREAD', 'REVIEW', 'BLOG_COMMENT', 'SELLER_PROFILE'
       )
     )
     OR (
       p_target_id IS NOT NULL
       AND (
         p_target_id = ''
         OR pg_catalog.char_length(p_target_id) > 191
       )
     ) THEN
    RAISE EXCEPTION 'UserReport submission input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO locked_user_count
    FROM (
      SELECT account.id
        FROM public."User" AS account
       WHERE account.id IN (actor_id, p_reported_user_id)
       ORDER BY account.id
       FOR SHARE
    ) AS locked_users;
  IF locked_user_count <> 2
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS reported
        WHERE reported.id = p_reported_user_id
          AND reported."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'UserReport submission actor or target is unavailable'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_type IS NULL THEN
    target_valid := true;
  ELSIF p_target_type = 'LISTING' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public."Listing" AS listing
        JOIN public."SellerProfile" AS seller
          ON seller.id = listing."sellerId"
       WHERE listing.id = p_target_id
         AND seller."userId" = p_reported_user_id
         AND listing."archivedAt" IS NULL
         AND (
           seller."userId" = actor_id
           OR (
             listing."isPrivate" = true
             AND listing.status::text IN ('ACTIVE', 'SOLD')
             AND listing."reservedForUserId" = actor_id
             AND seller."ownerAccountActive" = true
             AND seller."chargesEnabled" = true
             AND seller."stripeAccountSupported" = true
             AND seller."vacationMode" = false
           )
           OR (
             listing."isPrivate" = false
             AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
             AND seller."ownerAccountActive" = true
             AND seller."chargesEnabled" = true
             AND seller."stripeAccountSupported" = true
             AND seller."vacationMode" = false
           )
         )
    ) INTO target_valid;
  ELSIF p_target_type = 'REVIEW' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public."Review" AS review
        JOIN public."Listing" AS listing
          ON listing.id = review."listingId"
        JOIN public."SellerProfile" AS seller
          ON seller.id = listing."sellerId"
       WHERE review.id = p_target_id
         AND review."reviewerId" = p_reported_user_id
         AND (
           review."reviewerId" = actor_id
           OR seller."userId" = actor_id
           OR (
             listing."archivedAt" IS NULL
             AND (
               (
                 listing."isPrivate" = true
                 AND listing.status::text IN ('ACTIVE', 'SOLD')
                 AND listing."reservedForUserId" = actor_id
                 AND seller."ownerAccountActive" = true
                 AND seller."chargesEnabled" = true
                 AND seller."stripeAccountSupported" = true
                 AND seller."vacationMode" = false
               )
               OR (
                 listing."isPrivate" = false
                 AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
                 AND seller."ownerAccountActive" = true
                 AND seller."chargesEnabled" = true
                 AND seller."stripeAccountSupported" = true
                 AND seller."vacationMode" = false
               )
             )
           )
         )
    ) INTO target_valid;
  ELSIF p_target_type = 'MESSAGE_THREAD' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public."Conversation" AS conversation
       WHERE conversation.id = p_target_id
         AND actor_id IN (conversation."userAId", conversation."userBId")
         AND p_reported_user_id IN (
           conversation."userAId", conversation."userBId"
         )
    ) INTO target_valid;
  ELSIF p_target_type = 'BLOG_COMMENT' THEN
    SELECT EXISTS (
      SELECT 1
        FROM public."BlogComment" AS comment
        JOIN public."BlogPost" AS post ON post.id = comment."postId"
       WHERE comment.id = p_target_id
         AND comment."authorId" = p_reported_user_id
         AND comment.approved = true
         AND post.status = 'PUBLISHED'::public."BlogPostStatus"
         AND post."publishedAt" IS NOT NULL
         AND post."publishedAt" <= (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
         AND post."authorAccountActive" = true
         AND (
           post."sellerProfileId" IS NULL
           OR post."authorSellerPubliclyOrderable" = true
         )
    ) INTO target_valid;
  ELSE
    target_valid := public.grainline_seller_public_report_target(
      p_target_id,
      p_reported_user_id
    );
  END IF;

  IF target_valid IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'UserReport target is invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public."UserReport" (
    id, "reporterId", "reportedId", reason, details, "targetType", "targetId",
    resolved, "createdAt"
  ) VALUES (
    p_report_id, actor_id, p_reported_user_id, p_reason, p_details,
    p_target_type, p_target_id, false,
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
  );

  "reportId" := p_report_id;
  "reportedId" := p_reported_user_id;
  "targetType" := p_target_type;
  "targetId" := p_target_id;
  RETURN NEXT;
END
$grainline_user_report_submit$;

CREATE FUNCTION public.grainline_user_report_owner_submitted_export()
RETURNS TABLE (
  id text,
  "reportedId" text,
  reason text,
  details text,
  "targetType" text,
  "targetId" text,
  resolved boolean,
  "resolvedAt" timestamp without time zone,
  "resolutionNote" text,
  "createdAt" timestamp without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_report_owner_submitted_export$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'UserReport submitted export actor is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT report.id, report."reportedId", report.reason::text, report.details::text,
         report."targetType"::text, report."targetId"::text, report.resolved,
         report."resolvedAt", report."resolutionNote"::text, report."createdAt"
    FROM public."UserReport" AS report
   WHERE report."reporterId" = actor_id
   ORDER BY report."createdAt" DESC, report.id DESC;
END
$grainline_user_report_owner_submitted_export$;

CREATE FUNCTION public.grainline_user_report_owner_received_export()
RETURNS TABLE (
  id text,
  reason text,
  "targetType" text,
  "targetId" text,
  resolved boolean,
  "resolvedAt" timestamp without time zone,
  "resolutionNote" text,
  "createdAt" timestamp without time zone
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_report_owner_received_export$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF actor_id IS NULL OR actor_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'UserReport received export actor is invalid'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT report.id, report.reason::text, report."targetType"::text,
         report."targetId"::text, report.resolved, report."resolvedAt",
         report."resolutionNote"::text, report."createdAt"
    FROM public."UserReport" AS report
   WHERE report."reportedId" = actor_id
   ORDER BY report."createdAt" DESC, report.id DESC;
END
$grainline_user_report_owner_received_export$;

CREATE FUNCTION public.grainline_user_report_staff_open_count(
  p_actor_user_id text
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_report_staff_open_count$
DECLARE
  open_count bigint;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = p_actor_user_id
          AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'UserReport staff count is forbidden'
      USING ERRCODE = '42501';
  END IF;
  SELECT pg_catalog.count(*)::bigint
    INTO open_count
    FROM public."UserReport" AS report
   WHERE report.resolved = false;
  RETURN open_count;
END
$grainline_user_report_staff_open_count$;

CREATE FUNCTION public.grainline_user_report_staff_open_page(
  p_actor_user_id text,
  p_after_created_at timestamp without time zone,
  p_after_id text,
  p_limit integer
)
RETURNS TABLE (
  id text,
  reason text,
  details text,
  "targetType" text,
  "targetId" text,
  "createdAt" timestamp without time zone,
  "reporterId" text,
  "reportedId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_report_staff_open_page$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR (p_after_created_at IS NULL) <> (p_after_id IS NULL)
     OR (p_after_id IS NOT NULL AND p_after_id !~ '^[A-Za-z0-9._:-]{1,191}$')
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 50
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = p_actor_user_id
          AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'UserReport staff page is forbidden'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT report.id, report.reason::text, report.details::text,
         report."targetType"::text, report."targetId"::text,
         report."createdAt", report."reporterId", report."reportedId"
    FROM public."UserReport" AS report
   WHERE report.resolved = false
     AND (
       p_after_created_at IS NULL
       OR (report."createdAt", report.id) > (p_after_created_at, p_after_id)
     )
   ORDER BY report."createdAt", report.id
   LIMIT p_limit;
END
$grainline_user_report_staff_open_page$;

CREATE FUNCTION public.grainline_user_report_staff_top_reporters(
  p_actor_user_id text,
  p_since timestamp without time zone,
  p_limit integer
)
RETURNS TABLE ("reporterId" text, value bigint)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_report_staff_top_reporters$
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_since IS NULL
     OR p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 20
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = p_actor_user_id
          AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'UserReport staff aggregate is forbidden'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT report."reporterId", pg_catalog.count(*)::bigint
    FROM public."UserReport" AS report
   WHERE report."createdAt" >= p_since
   GROUP BY report."reporterId"
   ORDER BY pg_catalog.count(*) DESC, report."reporterId"
   LIMIT p_limit;
END
$grainline_user_report_staff_top_reporters$;

CREATE FUNCTION public.grainline_user_report_staff_resolve(
  p_actor_user_id text,
  p_report_id text,
  p_participant_rationale text,
  p_internal_note text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_report_staff_resolve$
DECLARE
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  normalized_rationale text := pg_catalog.btrim(p_participant_rationale);
  normalized_internal_note text := NULLIF(pg_catalog.btrim(p_internal_note), '');
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime'
     OR p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_report_id IS NULL
     OR p_report_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR normalized_rationale IS NULL
     OR pg_catalog.char_length(normalized_rationale) NOT BETWEEN 1 AND 500
     OR (
       normalized_internal_note IS NOT NULL
       AND pg_catalog.char_length(normalized_internal_note) > 1000
     )
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = p_actor_user_id
          AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'UserReport staff resolution is forbidden'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM public."UserReport" AS report
   WHERE report.id = p_report_id
     AND report.resolved = false
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'UNCHANGED';
  END IF;

  UPDATE public."UserReport"
     SET resolved = true,
         "resolvedAt" = source_now,
         "resolvedById" = p_actor_user_id,
         "resolutionNote" = normalized_rationale,
         "internalResolutionNote" = normalized_internal_note
   WHERE id = p_report_id;

  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", metadata, undone,
    "createdAt"
  ) VALUES (
    'user-report-resolved:' || pg_catalog.gen_random_uuid()::text,
    p_actor_user_id,
    'RESOLVE_REPORT',
    'UserReport',
    p_report_id,
    pg_catalog.jsonb_build_object(
      'resolutionNoteStored', true,
      'resolutionNoteLength', pg_catalog.char_length(normalized_rationale),
      'internalNoteStored', normalized_internal_note IS NOT NULL,
      'internalNoteLength', COALESCE(pg_catalog.char_length(normalized_internal_note), 0)
    ),
    false,
    source_now
  );
  RETURN 'UPDATED';
END
$grainline_user_report_staff_resolve$;

CREATE FUNCTION public.grainline_user_report_account_deletion_redact(
  p_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid
)
RETURNS TABLE (
  "userId" text,
  "detailsRedacted" integer,
  "resolvedNotesRedacted" integer,
  "reportsAutoResolved" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_report_account_deletion_redact$
DECLARE
  actor_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  claimed_user_id text;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  claimed_user_id := public.grainline_account_deletion_claim_user(
    p_side_effect_id,
    p_claim_generation,
    p_claim_token
  );
  IF actor_id IS NULL OR actor_id IS DISTINCT FROM claimed_user_id THEN
    RAISE EXCEPTION 'UserReport account-deletion claim actor changed'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public."UserReport" AS report
     SET details = NULL
   WHERE (report."reporterId" = actor_id OR report."reportedId" = actor_id)
     AND report.details IS NOT NULL;
  GET DIAGNOSTICS "detailsRedacted" = ROW_COUNT;

  UPDATE public."UserReport" AS report
     SET "resolutionNote" =
           'Resolution note removed after an involved account was deleted.',
         "internalResolutionNote" = NULL
   WHERE (report."reporterId" = actor_id OR report."reportedId" = actor_id)
     AND report.resolved = true
     AND (
       report."resolutionNote" IS DISTINCT FROM
         'Resolution note removed after an involved account was deleted.'
       OR report."internalResolutionNote" IS NOT NULL
     );
  GET DIAGNOSTICS "resolvedNotesRedacted" = ROW_COUNT;

  UPDATE public."UserReport" AS report
     SET resolved = true,
         "resolvedAt" = source_now,
         "resolvedById" = NULL,
         "resolutionNote" =
           'Auto-resolved after the reported account was deleted.',
         "internalResolutionNote" = NULL
   WHERE report."reportedId" = actor_id
     AND report.resolved = false;
  GET DIAGNOSTICS "reportsAutoResolved" = ROW_COUNT;

  "userId" := actor_id;
  RETURN NEXT;
END
$grainline_user_report_account_deletion_redact$;

REVOKE ALL ON FUNCTION public.grainline_user_report_submit(
  text,text,text,text,text,text
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_report_owner_submitted_export()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_report_owner_received_export()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_report_staff_open_count(text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_report_staff_open_page(
  text,timestamp without time zone,text,integer
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_report_staff_top_reporters(
  text,timestamp without time zone,integer
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_report_staff_resolve(
  text,text,text,text
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_report_account_deletion_redact(
  text,bigint,uuid
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_user_report_submit(
  text,text,text,text,text,text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_report_owner_submitted_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_report_owner_received_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_report_account_deletion_redact(
  text,bigint,uuid
) TO grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_user_report_staff_open_count(text)
  TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_report_staff_open_page(
  text,timestamp without time zone,text,integer
) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_report_staff_top_reporters(
  text,timestamp without time zone,integer
) TO grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_report_staff_resolve(
  text,text,text,text
) TO grainline_staff_read_runtime;

DO $grainline_user_report_postflight$
DECLARE
  table_oid oid := 'public."UserReport"'::pg_catalog.regclass;
  function_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attname = 'internalResolutionNote'
       AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
             = 'character varying(1000)'
       AND NOT attribute.attnotnull
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'UserReport internal-note column drifted';
  END IF;
  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY(ARRAY[
       'grainline_user_report_submit',
       'grainline_user_report_owner_submitted_export',
       'grainline_user_report_owner_received_export',
       'grainline_user_report_staff_open_count',
       'grainline_user_report_staff_open_page',
       'grainline_user_report_staff_top_reporters',
       'grainline_user_report_staff_resolve',
       'grainline_user_report_account_deletion_redact'
     ]::text[])
     AND procedure.prosecdef
     AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[];
  IF function_count <> 8 THEN
    RAISE EXCEPTION 'UserReport prepared authority catalog drifted';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = table_oid
       AND (class.relrowsecurity OR class.relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'UserReport preparation changed RLS posture';
  END IF;
END
$grainline_user_report_postflight$;

COMMIT;
