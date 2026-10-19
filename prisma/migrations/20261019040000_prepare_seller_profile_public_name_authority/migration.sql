-- Add the bounded public seller-name suggestion authority.
--
-- Global and blog suggestions need only an id and display name. This operation
-- owns active-seller, optional public-listing, reciprocal-block, search, order,
-- and result-limit rules. It never returns normalized search state, ownership,
-- provider state, or any other profile column. Predecessor grants remain.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_name_suggestions(
  p_query text,
  p_normalized_query text,
  p_require_public_listing boolean,
  p_limit integer
)
RETURNS TABLE (
  id text,
  "displayName" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_name_suggestions$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  escaped_query text := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(p_query, E'\\', E'\\\\'),
      '%', E'\\%'
    ),
    '_', E'\\_'
  );
  escaped_normalized_query text := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(p_normalized_query, E'\\', E'\\\\'),
      '%', E'\\%'
    ),
    '_', E'\\_'
  );
BEGIN
  IF p_query IS NULL
     OR pg_catalog.char_length(p_query) < 1
     OR pg_catalog.char_length(p_query) > 200
     OR p_normalized_query IS NULL
     OR pg_catalog.char_length(p_normalized_query) > 100
     OR p_require_public_listing IS NULL
     OR p_limit IS NULL
     OR p_limit < 1
     OR p_limit > 10 THEN
    RAISE EXCEPTION 'Seller public name suggestion input is invalid'
      USING ERRCODE = '22023';
  END IF;

  IF request_user_id IS NOT NULL
     AND (
       request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
       OR NOT EXISTS (
         SELECT 1
           FROM public."User" AS request_user
          WHERE request_user.id = request_user_id
            AND request_user.banned = false
            AND request_user."deletedAt" IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'Seller public name suggestion viewer context is invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT seller.id,
         seller."displayName"::text
    FROM public."SellerProfile" AS seller
   WHERE seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
     AND (
       seller."displayName" ILIKE ('%' || escaped_query || '%') ESCAPE E'\\'
       OR (
         p_normalized_query <> ''
         AND seller."displayNameNormalized" ILIKE
           ('%' || escaped_normalized_query || '%') ESCAPE E'\\'
       )
     )
     AND (
       p_require_public_listing = false
       OR EXISTS (
         SELECT 1
           FROM public."Listing" AS listing
          WHERE listing."sellerId" = seller.id
            AND listing.status::text = 'ACTIVE'
            AND listing."isPrivate" = false
            AND listing."archivedAt" IS NULL
       )
     )
     AND (
       request_user_id IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public."Block" AS relationship
          WHERE (
            relationship."blockerId" = request_user_id
            AND relationship."blockedId" = seller."userId"
          )
             OR (
               relationship."blockerId" = seller."userId"
               AND relationship."blockedId" = request_user_id
             )
       )
     )
   ORDER BY seller."displayNameNormalized" ASC, seller.id ASC
   LIMIT p_limit;
END
$grainline_seller_public_name_suggestions$;

REVOKE ALL ON FUNCTION public.grainline_seller_public_name_suggestions(
  text,
  text,
  boolean,
  integer
) FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_public_name_suggestions(
  text,
  text,
  boolean,
  integer
) TO grainline_app_runtime;

COMMIT;
