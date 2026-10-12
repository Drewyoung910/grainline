-- Add the key-scoped media enqueue used by the claim-fenced account-deletion
-- application. The predecessor URL RPC remains available only for live old
-- instances during the preparation window and is retired by activation.

DO $grainline_account_deletion_media_key_preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.grainline_account_deletion_media_enqueue_claimed(text,bigint,uuid,text[])'
     ) IS NULL THEN
    RAISE EXCEPTION
      'Account deletion media key preparation requires the claim-fence migration';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE rolname = 'grainline_app_runtime'
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE rolname = 'grainline_account_deletion_runtime'
  ) THEN
    RAISE EXCEPTION
      'Account deletion media key preparation requires both runtime roles';
  END IF;
END
$grainline_account_deletion_media_key_preflight$;

CREATE FUNCTION public.grainline_account_deletion_media_key_enqueue_claimed(
  p_parent_side_effect_id text,
  p_claim_generation bigint,
  p_claim_token uuid,
  p_keys text[]
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_account_deletion_media_key_enqueue_claimed$
DECLARE
  source_effect public."AccountDeletionSideEffect"%ROWTYPE;
  source_actor_segment text;
  inserted_count bigint;
BEGIN
  IF p_parent_side_effect_id IS NULL
     OR pg_catalog.btrim(p_parent_side_effect_id) = ''
     OR pg_catalog.char_length(p_parent_side_effect_id) > 191
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_claim_token IS NULL
     OR COALESCE(pg_catalog.array_length(p_keys, 1), 0) > 500 THEN
    RAISE EXCEPTION 'Account deletion media key enqueue claim is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT effect.*
    INTO source_effect
    FROM public."AccountDeletionSideEffect" AS effect
   WHERE effect.id = p_parent_side_effect_id
     AND effect.status = 'PROCESSING'
     AND effect.kind = 'LOCAL_ANONYMIZE'
     AND effect."dedupKey" = 'account-delete:local:' || effect."userId"
     AND effect.payload = '{}'::jsonb
     AND effect."claimGeneration" = p_claim_generation
     AND effect."claimToken" = p_claim_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account deletion media key enqueue source is not authorized'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(
           NULLIF(
             pg_catalog.left(
               pg_catalog.regexp_replace(
                 account_user."clerkId",
                 '[^A-Za-z0-9_-]',
                 '_',
                 'g'
               ),
               128
             ),
             ''
           ),
           'user'
         )
    INTO STRICT source_actor_segment
    FROM public."User" AS account_user
   WHERE account_user.id = source_effect."userId";

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(COALESCE(p_keys, ARRAY[]::text[])) AS supplied(key)
     WHERE supplied.key IS NULL
        OR pg_catalog.char_length(supplied.key) NOT BETWEEN 1 AND 500
        OR supplied.key ~ '[[:cntrl:]]'
        OR pg_catalog.strpos(supplied.key, '..') > 0
        OR pg_catalog.split_part(supplied.key, '/', 1) NOT IN (
          'bannerImage',
          'galleryImage',
          'listingImage',
          'listingVideo',
          'messageImage',
          'messageAny',
          'messageFile',
          'reviewPhoto',
          'blogImage'
        )
        OR pg_catalog.split_part(supplied.key, '/', 2)
             IS DISTINCT FROM source_actor_segment
        OR pg_catalog.split_part(supplied.key, '/', 3) = ''
  ) THEN
    RAISE EXCEPTION 'Account deletion media key is not scoped to the deleted user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH inserted AS (
    INSERT INTO public."AccountDeletionSideEffect" (
      id,
      "userId",
      kind,
      "dedupKey",
      payload,
      status,
      attempts,
      "claimGeneration",
      "claimToken",
      "processingStartedAt",
      "nextAttemptAt",
      "processedAt",
      "lastError",
      "createdAt",
      "updatedAt"
    )
    SELECT
      'account-delete-media:' || pg_catalog.gen_random_uuid()::text,
      source_effect."userId",
      'MEDIA_DELETE',
      'account-delete:media:' || source_effect."userId" || ':' ||
        pg_catalog.substr(
          pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(supplied.key, 'UTF8')),
            'hex'
          ),
          1,
          32
        ),
      pg_catalog.jsonb_build_object('key', supplied.key),
      'PENDING',
      0,
      0,
      NULL,
      NULL,
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
      NULL,
      NULL,
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC',
      pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
      FROM (
        SELECT DISTINCT key
          FROM pg_catalog.unnest(COALESCE(p_keys, ARRAY[]::text[])) AS candidate(key)
      ) AS supplied
    ON CONFLICT ("dedupKey") DO NOTHING
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::bigint
    INTO STRICT inserted_count
    FROM inserted;

  RETURN inserted_count;
END
$grainline_account_deletion_media_key_enqueue_claimed$;

REVOKE ALL ON FUNCTION
  public.grainline_account_deletion_media_key_enqueue_claimed(text, bigint, uuid, text[])
  FROM PUBLIC, grainline_app_runtime, grainline_account_deletion_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_account_deletion_media_key_enqueue_claimed(text, bigint, uuid, text[])
  TO grainline_app_runtime;

COMMENT ON FUNCTION
  public.grainline_account_deletion_media_key_enqueue_claimed(text, bigint, uuid, text[]) IS
  'Enqueues public-media deletion keys only when their endpoint and Clerk-user segment match the active LOCAL_ANONYMIZE claim.';
