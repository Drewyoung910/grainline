-- Preserve the committed pre-RLS RPC migration as immutable history while
-- narrowing the live list function to the explicitly reviewed SavedSearch
-- columns. A future table-column addition must fail closed until this contract
-- and the application projection are deliberately updated together.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_saved_search_list(
  p_user_id text,
  p_take integer DEFAULT NULL,
  p_search_id text DEFAULT NULL
)
RETURNS SETOF public."SavedSearch"
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_saved_search_list$
DECLARE
  prior_user_id text := pg_catalog.current_setting('app.user_id', true);
  applied_user_id text;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id = ''
     OR p_user_id <> pg_catalog.btrim(p_user_id)
     OR pg_catalog.char_length(p_user_id) > 128
     OR p_user_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION 'SavedSearch user context requires a bounded local user id'
      USING ERRCODE = '22023';
  END IF;

  IF p_take IS NOT NULL AND (p_take < 1 OR p_take > 25) THEN
    RAISE EXCEPTION 'SavedSearch list limit must be between 1 and 25'
      USING ERRCODE = '22023';
  END IF;

  IF prior_user_id IS NOT NULL
     AND prior_user_id <> ''
     AND prior_user_id <> p_user_id THEN
    RAISE EXCEPTION 'refusing to switch SavedSearch user context'
      USING ERRCODE = '42501';
  END IF;

  applied_user_id := pg_catalog.set_config('app.user_id', p_user_id, true);
  IF applied_user_id IS DISTINCT FROM p_user_id
     OR pg_catalog.current_setting('app.user_id', true) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'failed to establish SavedSearch user context'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
      saved_search.id,
      saved_search."userId",
      saved_search.query,
      saved_search.category,
      saved_search."minPrice",
      saved_search."maxPrice",
      saved_search.tags,
      saved_search."notifyEmail",
      saved_search."createdAt",
      saved_search."listingType",
      saved_search."shipsWithinDays",
      saved_search."minRating",
      saved_search.lat,
      saved_search.lng,
      saved_search."radiusMiles",
      saved_search.sort
    FROM public."SavedSearch" AS saved_search
   WHERE saved_search."userId" = p_user_id
     AND (p_search_id IS NULL OR saved_search.id = p_search_id)
   ORDER BY saved_search."createdAt" DESC
   LIMIT p_take;
END;
$grainline_saved_search_list$;

REVOKE ALL ON FUNCTION public.grainline_saved_search_list(text, integer, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_saved_search_list(text, integer, text)
  FROM grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_saved_search_list(text, integer, text)
  TO grainline_app_runtime;

COMMIT;
