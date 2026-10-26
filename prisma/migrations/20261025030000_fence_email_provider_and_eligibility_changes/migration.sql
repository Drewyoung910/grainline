-- Serialize every active-to-ineligible email transition with the final
-- provider-start decision. The boundary is database-local and no lock spans
-- Resend I/O: whichever transaction commits provider-start first defines an
-- already-in-flight attempt; every later attempt observes the new eligibility.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE
  user_owner oid;
BEGIN
  IF pg_catalog.to_regclass('public."User"') IS NULL
     OR pg_catalog.to_regclass('public."EmailSuppression"') IS NULL
     OR pg_catalog.to_regclass('public."NewsletterSubscriber"') IS NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_email_outbox_lock_keys(text[],text[])'
        ) IS NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_user_clerk_identity_ensure(text,text,text,boolean,text,boolean,text,boolean)'
        ) IS NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_user_owner_notification_preference_update(text,text,boolean)'
        ) IS NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_user_unsubscribe_preferences_disable(text[])'
        ) IS NULL
     OR pg_catalog.to_regprocedure(
          'public.grainline_user_staff_ban_apply(text,text,timestamp without time zone,text)'
        ) IS NULL THEN
    RAISE EXCEPTION 'Email eligibility fence predecessors are unavailable';
  END IF;

  SELECT class.relowner
    INTO STRICT user_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."User"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          (
            'public.grainline_email_outbox_lock_keys(text[],text[])',
            'd2fff79ab3891fe7c80eeb7bcfe93e7f'
          ),
          (
            'public.grainline_user_clerk_identity_ensure(text,text,text,boolean,text,boolean,text,boolean)',
            'ddbd40600df8fe58f00661a900e44833'
          ),
          (
            'public.grainline_user_owner_notification_preference_update(text,text,boolean)',
            '67a3a4e9ee00076393dd050daf2158b7'
          ),
          (
            'public.grainline_user_unsubscribe_preferences_disable(text[])',
            'd8f4e2a60455233fc7da9f19e242b0a9'
          ),
          (
            'public.grainline_user_staff_ban_apply(text,text,timestamp without time zone,text)',
            '1ad3e2eb194e15d04ff5b8eecfca4ae6'
          )
      ) AS expected(signature, source_hash)
      LEFT JOIN pg_catalog.pg_proc AS routine
        ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
     WHERE routine.oid IS NULL
        OR pg_catalog.md5(routine.prosrc) <> expected.source_hash
        OR routine.proowner <> user_owner
        OR routine.provolatile <> 'v'
        OR routine.proparallel <> 'u'
        OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
        OR (
          expected.signature <> 'public.grainline_email_outbox_lock_keys(text[],text[])'
          AND NOT routine.prosecdef
        )
        OR (
          expected.signature = 'public.grainline_email_outbox_lock_keys(text[],text[])'
          AND routine.prosecdef
        )
  ) THEN
    RAISE EXCEPTION 'Email eligibility fence predecessor definition drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = 'public.grainline_email_outbox_lock_keys(text[],text[])'::pg_catalog.regprocedure
       AND EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
           ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'Email eligibility lock helper is PUBLIC-executable';
  END IF;
END
$preflight$;

-- Wait for predecessor writers before replacing their definitions, so no
-- transaction running old lock-free code can overlap the new contract.
LOCK TABLE public."User", public."EmailSuppression", public."NewsletterSubscriber"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.grainline_user_clerk_identity_ensure(
  p_new_user_id text,
  p_clerk_id text,
  p_email text,
  p_update_email boolean,
  p_name text,
  p_update_name boolean,
  p_image_url text,
  p_update_image boolean
)
RETURNS TABLE (
  user_id text,
  email_conflict boolean,
  created boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_clerk_identity_ensure$
DECLARE
  account_id text;
  account_email text;
  account_banned boolean;
  account_deleted_at timestamp(3);
  desired_email text;
  placeholder_email text;
  conflict_detected boolean := false;
  constraint_name text;
  changed_at timestamp(3);
BEGIN
  IF p_new_user_id IS NULL
     OR p_new_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_clerk_id IS NULL
     OR p_clerk_id !~ '^[A-Za-z0-9._:-]{1,255}$' THEN
    RAISE EXCEPTION 'Clerk identity input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_update_email IS NULL
     OR p_update_name IS NULL
     OR p_update_image IS NULL THEN
    RAISE EXCEPTION 'Clerk identity update flags are invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_update_email THEN
    desired_email := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_email)), '');
    IF desired_email IS NULL
       OR pg_catalog.char_length(desired_email) > 254
       OR pg_catalog.strpos(desired_email, '@') <= 1
       OR desired_email IS DISTINCT FROM p_email THEN
      RAISE EXCEPTION 'Clerk identity email is invalid'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_email IS NOT NULL THEN
    RAISE EXCEPTION 'Clerk identity email flag is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF (NOT p_update_name AND p_name IS NOT NULL)
     OR (p_name IS NOT NULL AND pg_catalog.char_length(p_name) > 100)
     OR (NOT p_update_image AND p_image_url IS NOT NULL)
     OR (p_image_url IS NOT NULL AND pg_catalog.char_length(p_image_url) > 2048) THEN
    RAISE EXCEPTION 'Clerk identity profile input is invalid'
      USING ERRCODE = '22023';
  END IF;

  placeholder_email := CASE
    WHEN p_clerk_id = pg_catalog.lower(p_clerk_id) THEN
      p_clerk_id || '@placeholder.invalid'
    ELSE
      pg_catalog.left(pg_catalog.lower(p_clerk_id), 200)
        || '-' || pg_catalog.md5(p_clerk_id) || '@placeholder.invalid'
  END;
  IF pg_catalog.char_length(placeholder_email) > 254 THEN
    RAISE EXCEPTION 'Clerk identity placeholder email is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_clerk_id, 20261003)
  );

  <<ensure_account>>
  LOOP
    account_id := NULL;
    conflict_detected := false;
    SELECT account_user.id, account_user.email
      INTO account_id, account_email
      FROM public."User" AS account_user
     WHERE account_user."clerkId" = p_clerk_id;

    IF FOUND THEN
      -- Stable account keys always precede address keys and mutable rows.
      PERFORM public.grainline_email_outbox_lock_keys(
        ARRAY[account_id],
        ARRAY[]::text[]
      );
      PERFORM public.grainline_email_outbox_lock_keys(
        ARRAY[]::text[],
        ARRAY[account_email, desired_email]
      );

      SELECT
        account_user.id,
        account_user.email,
        account_user.banned,
        account_user."deletedAt"
        INTO account_id, account_email, account_banned, account_deleted_at
        FROM public."User" AS account_user
       WHERE account_user."clerkId" = p_clerk_id
       FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE ensure_account;
      END IF;
      IF account_banned OR account_deleted_at IS NOT NULL THEN
        RETURN QUERY SELECT account_id, false, false;
        RETURN;
      END IF;

      changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
      IF p_update_email OR p_update_name OR p_update_image THEN
        BEGIN
          UPDATE public."User" AS account_user
             SET email = CASE WHEN p_update_email THEN desired_email ELSE account_user.email END,
                 name = CASE WHEN p_update_name THEN p_name ELSE account_user.name END,
                 "imageUrl" = CASE WHEN p_update_image THEN p_image_url ELSE account_user."imageUrl" END,
                 "updatedAt" = changed_at
           WHERE account_user.id = account_id
          RETURNING account_user.email INTO account_email;
        EXCEPTION WHEN unique_violation THEN
          GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
          IF NOT p_update_email OR constraint_name <> 'User_email_key' THEN
            RAISE;
          END IF;
          conflict_detected := true;
          IF p_update_name OR p_update_image THEN
            UPDATE public."User" AS account_user
               SET name = CASE WHEN p_update_name THEN p_name ELSE account_user.name END,
                   "imageUrl" = CASE WHEN p_update_image THEN p_image_url ELSE account_user."imageUrl" END,
                   "updatedAt" = changed_at
             WHERE account_user.id = account_id
            RETURNING account_user.email INTO account_email;
          END IF;
        END;
      END IF;

      IF p_update_email AND NOT conflict_detected THEN
        PERFORM public.grainline_user_email_address_sync(
          account_id,
          account_email,
          'ensure_user'
        );
      END IF;
      RETURN QUERY SELECT account_id, conflict_detected, false;
      RETURN;
    END IF;

    account_email := CASE
      WHEN p_update_email THEN desired_email
      ELSE placeholder_email
    END;
    PERFORM public.grainline_email_outbox_lock_keys(
      ARRAY[p_new_user_id],
      ARRAY[account_email, placeholder_email]
    );
    changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';

    BEGIN
      INSERT INTO public."User" (
        id, "clerkId", email, name, "imageUrl", "createdAt", "updatedAt"
      ) VALUES (
        p_new_user_id,
        p_clerk_id,
        account_email,
        CASE WHEN p_update_name THEN p_name ELSE NULL END,
        CASE WHEN p_update_image THEN p_image_url ELSE NULL END,
        changed_at,
        changed_at
      )
      RETURNING id, email INTO account_id, account_email;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      IF constraint_name = 'User_clerkId_key' THEN
        CONTINUE ensure_account;
      END IF;
      IF NOT p_update_email OR constraint_name <> 'User_email_key' THEN
        RAISE;
      END IF;

      conflict_detected := true;
      account_email := placeholder_email;
      BEGIN
        INSERT INTO public."User" (
          id, "clerkId", email, name, "imageUrl", "createdAt", "updatedAt"
        ) VALUES (
          p_new_user_id,
          p_clerk_id,
          account_email,
          CASE WHEN p_update_name THEN p_name ELSE NULL END,
          CASE WHEN p_update_image THEN p_image_url ELSE NULL END,
          changed_at,
          changed_at
        )
        RETURNING id, email INTO account_id, account_email;
      EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
        IF constraint_name = 'User_clerkId_key' THEN
          CONTINUE ensure_account;
        END IF;
        RAISE;
      END;
    END;

    PERFORM public.grainline_user_email_address_sync(
      account_id,
      account_email,
      CASE
        WHEN conflict_detected THEN 'ensure_user_create_email_conflict'
        ELSE 'ensure_user_create'
      END
    );
    RETURN QUERY SELECT account_id, conflict_detected, true;
    RETURN;
  END LOOP;
END
$grainline_user_clerk_identity_ensure$;

CREATE OR REPLACE FUNCTION public.grainline_user_owner_notification_preference_update(
  p_user_id text,
  p_preference_key text,
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_owner_notification_preference_update$
DECLARE
  changed_at timestamp(3);
  updated_rows integer := 0;
  email_preference boolean;
  account_email text;
BEGIN
  email_preference := p_preference_key = ANY (ARRAY[
    'EMAIL_NEW_MESSAGE', 'EMAIL_NEW_ORDER',
    'EMAIL_CASE_OPENED', 'EMAIL_CASE_MESSAGE', 'EMAIL_CASE_RESOLVED',
    'EMAIL_REFUND_ISSUED', 'EMAIL_CUSTOM_ORDER',
    'EMAIL_VERIFICATION_APPROVED', 'EMAIL_VERIFICATION_REJECTED',
    'EMAIL_BACK_IN_STOCK', 'EMAIL_NEW_REVIEW',
    'EMAIL_FOLLOWED_MAKER_NEW_LISTING', 'EMAIL_SELLER_BROADCAST'
  ]::text[]);

  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_enabled IS NULL
     OR p_preference_key IS NULL
     OR p_preference_key <> ALL (ARRAY[
       'NEW_MESSAGE', 'NEW_ORDER', 'ORDER_SHIPPED', 'ORDER_DELIVERED',
       'CASE_OPENED', 'CASE_MESSAGE', 'CASE_RESOLVED', 'REFUND_ISSUED',
       'CUSTOM_ORDER_REQUEST', 'CUSTOM_ORDER_LINK',
       'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED',
       'BACK_IN_STOCK', 'NEW_REVIEW', 'LOW_STOCK', 'NEW_FAVORITE',
       'NEW_BLOG_COMMENT', 'BLOG_COMMENT_REPLY', 'NEW_FOLLOWER',
       'FOLLOWED_MAKER_NEW_LISTING', 'FOLLOWED_MAKER_NEW_BLOG',
       'SELLER_BROADCAST', 'COMMISSION_INTEREST', 'LISTING_APPROVED',
       'LISTING_REJECTED', 'ACCOUNT_WARNING', 'LISTING_FLAGGED_BY_USER',
       'PAYMENT_DISPUTE', 'PAYOUT_FAILED',
       'EMAIL_NEW_MESSAGE', 'EMAIL_NEW_ORDER', 'EMAIL_CASE_OPENED',
       'EMAIL_CASE_MESSAGE', 'EMAIL_CASE_RESOLVED', 'EMAIL_REFUND_ISSUED',
       'EMAIL_CUSTOM_ORDER', 'EMAIL_VERIFICATION_APPROVED',
       'EMAIL_VERIFICATION_REJECTED', 'EMAIL_BACK_IN_STOCK',
       'EMAIL_NEW_REVIEW', 'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
       'EMAIL_SELLER_BROADCAST'
     ]::text[]) THEN
    RAISE EXCEPTION 'Owner notification preference input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF email_preference THEN
    PERFORM public.grainline_email_outbox_lock_keys(
      ARRAY[p_user_id],
      ARRAY[]::text[]
    );
    SELECT account_user.email
      INTO account_email
      FROM public."User" AS account_user
     WHERE account_user.id = p_user_id;
    PERFORM public.grainline_email_outbox_lock_keys(
      ARRAY[]::text[],
      ARRAY[account_email]
    );
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."User" AS account_user
     SET "notificationPreferences" = pg_catalog.jsonb_set(
           COALESCE(account_user."notificationPreferences", '{}'::jsonb),
           ARRAY[p_preference_key]::text[],
           pg_catalog.to_jsonb(p_enabled),
           true
         ),
         "emailPreferenceOptInAt" = CASE
           WHEN p_enabled AND email_preference THEN changed_at
           ELSE account_user."emailPreferenceOptInAt"
         END,
         "updatedAt" = changed_at
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows = 1;
END
$grainline_user_owner_notification_preference_update$;

CREATE OR REPLACE FUNCTION public.grainline_user_unsubscribe_preferences_disable(
  p_suppression_keys text[]
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_unsubscribe_preferences_disable$
DECLARE
  candidate_key text;
  changed_at timestamp(3);
  updated_rows integer := 0;
BEGIN
  IF p_suppression_keys IS NULL
     OR pg_catalog.cardinality(p_suppression_keys) < 1
     OR pg_catalog.cardinality(p_suppression_keys) > 20 THEN
    RAISE EXCEPTION 'User unsubscribe preference input is invalid'
      USING ERRCODE = '22023';
  END IF;
  FOREACH candidate_key IN ARRAY p_suppression_keys LOOP
    IF candidate_key IS NULL
       OR candidate_key = ''
       OR pg_catalog.char_length(candidate_key) > 254
       OR candidate_key IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(candidate_key))
       OR pg_catalog.strpos(candidate_key, '@') <= 1 THEN
      RAISE EXCEPTION 'User unsubscribe suppression key is invalid'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- The signed action is address-scoped. Taking the address set before any
  -- User row means an email change either wins completely or waits completely.
  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[]::text[],
    p_suppression_keys
  );

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."User" AS account_user
     SET "notificationPreferences" =
           COALESCE(account_user."notificationPreferences", '{}'::jsonb)
           || pg_catalog.jsonb_build_object(
             'EMAIL_NEW_MESSAGE', false,
             'EMAIL_CUSTOM_ORDER', false,
             'EMAIL_VERIFICATION_APPROVED', false,
             'EMAIL_VERIFICATION_REJECTED', false,
             'EMAIL_BACK_IN_STOCK', false,
             'EMAIL_NEW_REVIEW', false,
             'EMAIL_FOLLOWED_MAKER_NEW_LISTING', false,
             'EMAIL_SELLER_BROADCAST', false
           ),
         "updatedAt" = changed_at
   WHERE CASE
     WHEN pg_catalog.lower(
            pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 2)
          ) IN ('gmail.com', 'googlemail.com')
     THEN pg_catalog.replace(
       pg_catalog.split_part(
         pg_catalog.lower(
           pg_catalog.split_part(pg_catalog.btrim(account_user.email), '@', 1)
         ),
         '+',
         1
       ),
       '.',
       ''
     ) || '@gmail.com'
     ELSE pg_catalog.lower(pg_catalog.btrim(account_user.email))
   END = ANY (p_suppression_keys);

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END
$grainline_user_unsubscribe_preferences_disable$;

CREATE OR REPLACE FUNCTION public.grainline_user_staff_ban_apply(
  p_capability_id text,
  p_target_id text,
  p_banned_at timestamp(3),
  p_reason text
)
RETURNS TABLE ("clerkId" text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_staff_ban_apply$
DECLARE
  source_actor_id text;
  target_clerk_id text;
  target_email text;
  target_role text;
  target_banned boolean;
  target_deleted_at timestamp(3);
BEGIN
  IF p_capability_id IS NULL
     OR p_capability_id !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR p_target_id IS NULL OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_banned_at IS NULL
     OR p_reason IS NULL OR pg_catalog.char_length(p_reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'User staff ban input is invalid' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public."OrderStaffCapability" AS capability
   WHERE capability.id = p_capability_id
     AND capability."targetUserId" = p_target_id
     AND capability.operation = 'USER_BAN'
     AND capability."payloadHash" IS NULL
     AND capability."expiresAt" >= pg_catalog.clock_timestamp()
  RETURNING capability."actorUserId" INTO source_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User ban capability is invalid or expired' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public."User" AS actor
   WHERE actor.id = source_actor_id AND actor.role::text = 'ADMIN'
     AND actor.banned = false AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User staff actor is not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[p_target_id],
    ARRAY[]::text[]
  );
  SELECT target.email
    INTO target_email
    FROM public."User" AS target
   WHERE target.id = p_target_id;
  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[]::text[],
    ARRAY[target_email]
  );

  SELECT target."clerkId", target.email, target.role::text,
         target.banned, target."deletedAt"
    INTO target_clerk_id, target_email, target_role,
         target_banned, target_deleted_at
    FROM public."User" AS target
   WHERE target.id = p_target_id
   FOR UPDATE;
  IF NOT FOUND OR target_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = 'P0002';
  ELSIF target_role = 'ADMIN' THEN
    RAISE EXCEPTION 'Cannot ban admin accounts' USING ERRCODE = '42501';
  ELSIF target_banned THEN
    RAISE EXCEPTION 'User ban state changed' USING ERRCODE = '40001';
  END IF;

  UPDATE public."User" AS target
     SET banned = true,
         "bannedAt" = p_banned_at,
         "banReason" = p_reason,
         "bannedBy" = source_actor_id,
         "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
   WHERE target.id = p_target_id;
  RETURN QUERY SELECT target_clerk_id;
END
$grainline_user_staff_ban_apply$;

CREATE OR REPLACE FUNCTION public.grainline_email_hard_suppression_apply(
  p_id text,
  p_email text,
  p_reason public."EmailSuppressionReason",
  p_source text,
  p_event_id text,
  p_details jsonb
)
RETURNS TABLE (
  email text,
  reason public."EmailSuppressionReason",
  source text,
  "eventId" text,
  details jsonb
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_email_hard_suppression_apply$
#variable_conflict use_column
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  stored record;
BEGIN
  IF p_id IS NULL
     OR p_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_email IS NULL
     OR p_email IS DISTINCT FROM pg_catalog.lower(pg_catalog.btrim(p_email))
     OR pg_catalog.char_length(p_email) NOT BETWEEN 3 AND 254
     OR pg_catalog.strpos(p_email, '@') <= 1
     OR p_reason::text NOT IN ('BOUNCE', 'COMPLAINT')
     OR p_source NOT IN ('resend', 'resend_provider_suppressed')
     OR (p_event_id IS NOT NULL AND pg_catalog.char_length(p_event_id) > 255)
     OR p_details IS NULL
     OR pg_catalog.jsonb_typeof(p_details) <> 'object'
     OR pg_catalog.octet_length(p_details::text) > 20000 THEN
    RAISE EXCEPTION 'Email hard-suppression input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.grainline_email_outbox_lock_keys(
    ARRAY[]::text[],
    ARRAY[p_email]
  );

  INSERT INTO public."EmailSuppression" AS suppression (
    id, email, reason, source, "eventId", details, "createdAt", "updatedAt"
  ) VALUES (
    p_id, p_email, p_reason, p_source, p_event_id, p_details,
    source_now, source_now
  )
  ON CONFLICT (email) DO UPDATE
     SET reason = EXCLUDED.reason,
         source = EXCLUDED.source,
         "eventId" = EXCLUDED."eventId",
         details = EXCLUDED.details,
         "updatedAt" = source_now
   WHERE NOT (
     p_source = 'resend_provider_suppressed'
     AND suppression.source = 'resend'
     AND suppression.reason::text IN ('BOUNCE', 'COMPLAINT')
   )
  RETURNING suppression.email, suppression.reason, suppression.source,
            suppression."eventId", suppression.details
       INTO stored;

  IF NOT FOUND THEN
    SELECT suppression.email, suppression.reason, suppression.source,
           suppression."eventId", suppression.details
      INTO STRICT stored
      FROM public."EmailSuppression" AS suppression
     WHERE suppression.email = p_email;
  END IF;

  UPDATE public."NewsletterSubscriber" AS subscriber
     SET active = false,
         "confirmationTokenHash" = NULL,
         "confirmationExpiresAt" = NULL,
         "confirmationSentAt" = NULL,
         "deactivatedAt" = COALESCE(subscriber."deactivatedAt", source_now)
   WHERE pg_catalog.lower(pg_catalog.btrim(subscriber.email)) = p_email
      OR (
        pg_catalog.lower(pg_catalog.split_part(p_email, '@', 2))
          IN ('gmail.com', 'googlemail.com')
        AND pg_catalog.lower(pg_catalog.split_part(subscriber.email, '@', 2))
          IN ('gmail.com', 'googlemail.com')
        AND pg_catalog.replace(
          pg_catalog.split_part(
            pg_catalog.lower(pg_catalog.split_part(subscriber.email, '@', 1)),
            '+',
            1
          ),
          '.',
          ''
        ) = pg_catalog.replace(
          pg_catalog.split_part(
            pg_catalog.lower(pg_catalog.split_part(p_email, '@', 1)),
            '+',
            1
          ),
          '.',
          ''
        )
      );

  RETURN QUERY SELECT stored.email::text, stored.reason, stored.source::text,
                      stored."eventId"::text, stored.details::jsonb;
END
$grainline_email_hard_suppression_apply$;

REVOKE ALL ON FUNCTION public.grainline_user_clerk_identity_ensure(
  text, text, text, boolean, text, boolean, text, boolean
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_owner_notification_preference_update(
  text, text, boolean
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_unsubscribe_preferences_disable(text[])
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_user_staff_ban_apply(
  text, text, timestamp without time zone, text
) FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_email_hard_suppression_apply(
  text, text, public."EmailSuppressionReason", text, text, jsonb
) FROM PUBLIC, grainline_app_runtime;

DO $grant_runtime$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime') THEN
    GRANT EXECUTE ON FUNCTION public.grainline_user_clerk_identity_ensure(
      text, text, text, boolean, text, boolean, text, boolean
    ) TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_user_owner_notification_preference_update(
      text, text, boolean
    ) TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_user_unsubscribe_preferences_disable(text[])
      TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_user_staff_ban_apply(
      text, text, timestamp without time zone, text
    ) TO grainline_app_runtime;
    GRANT EXECUTE ON FUNCTION public.grainline_email_hard_suppression_apply(
      text, text, public."EmailSuppressionReason", text, text, jsonb
    ) TO grainline_app_runtime;
  END IF;
END
$grant_runtime$;

DO $postflight$
DECLARE
  user_owner oid;
BEGIN
  SELECT class.relowner
    INTO STRICT user_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."User"'::pg_catalog.regclass
     AND class.relkind = 'r';

  IF pg_catalog.to_regprocedure(
       'public.grainline_email_hard_suppression_apply(text,text,"EmailSuppressionReason",text,text,jsonb)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Email hard-suppression authority is unavailable';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('public.grainline_user_clerk_identity_ensure(text,text,text,boolean,text,boolean,text,boolean)'),
          ('public.grainline_user_owner_notification_preference_update(text,text,boolean)'),
          ('public.grainline_user_unsubscribe_preferences_disable(text[])'),
          ('public.grainline_user_staff_ban_apply(text,text,timestamp without time zone,text)'),
          ('public.grainline_email_hard_suppression_apply(text,text,"EmailSuppressionReason",text,text,jsonb)')
      ) AS expected(signature)
      LEFT JOIN pg_catalog.pg_proc AS routine
        ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
     WHERE routine.oid IS NULL
        OR routine.proowner <> user_owner
        OR NOT routine.prosecdef
        OR routine.provolatile <> 'v'
        OR routine.proparallel <> 'u'
        OR routine.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
        OR pg_catalog.strpos(
             routine.prosrc,
             'PERFORM public.grainline_email_outbox_lock_keys('
           ) = 0
  ) THEN
    RAISE EXCEPTION 'Email eligibility fence function contract drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (
        VALUES
          ('public.grainline_user_clerk_identity_ensure(text,text,text,boolean,text,boolean,text,boolean)'),
          ('public.grainline_user_owner_notification_preference_update(text,text,boolean)'),
          ('public.grainline_user_unsubscribe_preferences_disable(text[])'),
          ('public.grainline_user_staff_ban_apply(text,text,timestamp without time zone,text)'),
          ('public.grainline_email_hard_suppression_apply(text,text,"EmailSuppressionReason",text,text,jsonb)')
      ) AS expected(signature)
      JOIN pg_catalog.pg_proc AS routine
        ON routine.oid = pg_catalog.to_regprocedure(expected.signature)
      JOIN pg_catalog.pg_roles AS grantee ON grantee.rolname = 'grainline_app_runtime'
     WHERE NOT pg_catalog.has_function_privilege(
       grantee.oid,
       routine.oid,
       'EXECUTE'
     )
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
            ) AS acl
           WHERE acl.grantee = 0
             AND acl.privilege_type = 'EXECUTE'
        )
  ) THEN
    RAISE EXCEPTION 'Email eligibility fence ACL drifted';
  END IF;
END
$postflight$;

COMMIT;
