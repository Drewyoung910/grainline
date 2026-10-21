-- Move the review-reply ownership recheck and conditional write behind one
-- actor-bound authority before SellerProfile loses direct runtime access.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_owner_review_reply(
  p_review_id text,
  p_expected_seller_profile_id text,
  p_reply text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_review_reply$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.current_setting('app.user_id', true),
    ''
  );
  reply_saved boolean := false;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Seller review-reply context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_review_id IS NULL
     OR p_review_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_expected_seller_profile_id IS NULL
     OR p_expected_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_reply IS NULL
     OR pg_catalog.length(p_reply) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Seller review-reply input is invalid'
      USING ERRCODE = '22023';
  END IF;

  WITH active_owner AS (
    SELECT seller.id
      FROM public."User" AS account_user
      JOIN public."SellerProfile" AS seller
        ON seller."userId" = account_user.id
     WHERE account_user.id = request_user_id
       AND account_user.banned = false
       AND account_user."deletedAt" IS NULL
       AND seller.id = p_expected_seller_profile_id
       AND seller."ownerAccountActive" = true
  ),
  updated_review AS (
    UPDATE public."Review" AS review
       SET "sellerReply" = p_reply,
           "sellerReplyAt" = pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
           "updatedAt" = pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'
      FROM public."Listing" AS listing,
           active_owner
     WHERE review.id = p_review_id
       AND review."sellerReply" IS NULL
       AND listing.id = review."listingId"
       AND listing."sellerId" = active_owner.id
    RETURNING review.id
  )
  SELECT EXISTS (SELECT 1 FROM updated_review)
    INTO reply_saved;

  RETURN reply_saved;
END
$grainline_seller_owner_review_reply$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_review_reply(text,text,text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_review_reply(text,text,text)
  TO grainline_app_runtime;

COMMIT;
