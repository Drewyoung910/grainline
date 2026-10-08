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
    SELECT
      account_user.id,
      account_user.email,
      account_user.banned,
      account_user."deletedAt"
      INTO account_id, account_email, account_banned, account_deleted_at
      FROM public."User" AS account_user
     WHERE account_user."clerkId" = p_clerk_id
     FOR UPDATE;

    IF FOUND THEN
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
    changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';

    BEGIN
      INSERT INTO public."User" (
        id,
        "clerkId",
        email,
        name,
        "imageUrl",
        "createdAt",
        "updatedAt"
      )
      VALUES (
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
          id,
          "clerkId",
          email,
          name,
          "imageUrl",
          "createdAt",
          "updatedAt"
        )
        VALUES (
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

REVOKE ALL ON FUNCTION
  public.grainline_user_clerk_identity_ensure(
    text,
    text,
    text,
    boolean,
    text,
    boolean,
    text,
    boolean
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_clerk_identity_ensure(
    text,
    text,
    text,
    boolean,
    text,
    boolean,
    text,
    boolean
  )
  TO grainline_app_runtime;
