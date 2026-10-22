BEGIN;

-- A completed outgoing Block owns the cleanup of both reciprocal Follow rows.
-- The caller supplies only the target user id; the blocker comes from the
-- transaction-local authenticated user context. The shared sorted pair lock
-- keeps cleanup ordered with ordinary block/unblock mutations.
CREATE OR REPLACE FUNCTION public.grainline_user_block_follow_cleanup(
  p_target_user_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_block_follow_cleanup$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_user_id IS NULL
     OR p_target_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_user_id = request_user_id THEN
    RAISE EXCEPTION 'User block follow cleanup input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public.grainline_user_block_pair_lock(p_target_user_id);

  IF NOT EXISTS (
    SELECT 1
      FROM public."Block" AS relationship
     WHERE relationship."blockerId" = request_user_id
       AND relationship."blockedId" = p_target_user_id
  ) THEN
    RAISE EXCEPTION 'User block follow cleanup requires an active block'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public."Follow" AS following
   WHERE (
     following."followerId" = request_user_id
     AND EXISTS (
       SELECT 1
         FROM public."SellerProfile" AS target_seller
        WHERE target_seller."userId" = p_target_user_id
          AND target_seller.id = following."sellerProfileId"
     )
   ) OR (
     following."followerId" = p_target_user_id
     AND EXISTS (
       SELECT 1
         FROM public."SellerProfile" AS actor_seller
        WHERE actor_seller."userId" = request_user_id
          AND actor_seller.id = following."sellerProfileId"
     )
   );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$grainline_user_block_follow_cleanup$;

REVOKE ALL ON FUNCTION public.grainline_user_block_follow_cleanup(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_block_follow_cleanup(text)
  TO grainline_app_runtime;

COMMIT;
