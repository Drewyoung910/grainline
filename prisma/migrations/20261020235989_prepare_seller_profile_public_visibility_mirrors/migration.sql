-- Transactionally maintained public seller projections for listing and blog
-- visibility. These bounded mirrors preserve the existing public eligibility,
-- seller-name search and rating filters after direct SellerProfile authority is
-- revoked. This preparation does not change SellerProfile grants, policies or
-- RLS posture.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public."SellerProfile",
           public."SellerRatingSummary",
           public."Listing",
           public."BlogPost"
  IN SHARE ROW EXCLUSIVE MODE;

DO $grainline_seller_public_visibility_preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.grainline_blog_post_author_public_state_bind()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.grainline_seller_public_blog_state_sync()'
     ) IS NULL THEN
    RAISE EXCEPTION 'Seller public visibility predecessor functions are missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid IN (
             'public."Listing"'::pg_catalog.regclass,
             'public."BlogPost"'::pg_catalog.regclass
           )
       AND attribute.attname IN (
             'sellerPubliclyOrderable',
             'sellerDisplayName',
             'sellerDisplayNameNormalized',
             'sellerAverageRating',
             'sellerReviewCount',
             'authorSellerPubliclyOrderable'
           )
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'Seller public visibility mirror columns already exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public."BlogPost"'::pg_catalog.regclass
       AND trigger_row.tgname = 'grainline_blog_post_author_public_state_bind'
       AND trigger_row.tgfoid = pg_catalog.to_regprocedure(
             'public.grainline_blog_post_author_public_state_bind()'
           )
       AND NOT trigger_row.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public."SellerProfile"'::pg_catalog.regclass
       AND trigger_row.tgname = 'grainline_seller_public_blog_state_sync'
       AND trigger_row.tgfoid = pg_catalog.to_regprocedure(
             'public.grainline_seller_public_blog_state_sync()'
           )
       AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Seller public visibility predecessor triggers drifted';
  END IF;
END
$grainline_seller_public_visibility_preflight$;

ALTER TABLE public."Listing"
  ADD COLUMN "sellerPubliclyOrderable" boolean,
  ADD COLUMN "sellerDisplayName" varchar(100),
  ADD COLUMN "sellerDisplayNameNormalized" varchar(100),
  ADD COLUMN "sellerAverageRating" double precision,
  ADD COLUMN "sellerReviewCount" integer;

ALTER TABLE public."BlogPost"
  ADD COLUMN "authorSellerPubliclyOrderable" boolean;

UPDATE public."Listing" AS listing
   SET "sellerPubliclyOrderable" = (
         seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
         AND seller."ownerAccountActive" = true
       ),
       "sellerDisplayName" = seller."displayName",
       "sellerDisplayNameNormalized" = seller."displayNameNormalized",
       "sellerAverageRating" = COALESCE(summary."averageRating", 0),
       "sellerReviewCount" = COALESCE(summary."reviewCount", 0)
  FROM public."SellerProfile" AS seller
  LEFT JOIN public."SellerRatingSummary" AS summary
    ON summary."sellerProfileId" = seller.id
 WHERE seller.id = listing."sellerId";

UPDATE public."BlogPost" AS post
   SET "authorSellerPubliclyOrderable" = (
         seller."chargesEnabled" = true
         AND seller."stripeAccountSupported" = true
         AND seller."vacationMode" = false
         AND seller."ownerAccountActive" = true
       )
  FROM public."SellerProfile" AS seller
 WHERE seller.id = post."sellerProfileId";

UPDATE public."BlogPost"
   SET "authorSellerPubliclyOrderable" = false
 WHERE "sellerProfileId" IS NULL;

DO $grainline_seller_public_visibility_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."Listing"
     WHERE "sellerPubliclyOrderable" IS NULL
        OR "sellerDisplayName" IS NULL
        OR "sellerDisplayNameNormalized" IS NULL
        OR "sellerAverageRating" IS NULL
        OR "sellerReviewCount" IS NULL
  ) OR EXISTS (
    SELECT 1
      FROM public."BlogPost"
     WHERE "authorSellerPubliclyOrderable" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller public visibility mirror backfill is incomplete';
  END IF;
END
$grainline_seller_public_visibility_backfill$;

ALTER TABLE public."Listing"
  ALTER COLUMN "sellerPubliclyOrderable" SET DEFAULT false,
  ALTER COLUMN "sellerPubliclyOrderable" SET NOT NULL,
  ALTER COLUMN "sellerDisplayName" SET DEFAULT '',
  ALTER COLUMN "sellerDisplayName" SET NOT NULL,
  ALTER COLUMN "sellerDisplayNameNormalized" SET DEFAULT '',
  ALTER COLUMN "sellerDisplayNameNormalized" SET NOT NULL,
  ALTER COLUMN "sellerAverageRating" SET DEFAULT 0,
  ALTER COLUMN "sellerAverageRating" SET NOT NULL,
  ALTER COLUMN "sellerReviewCount" SET DEFAULT 0,
  ALTER COLUMN "sellerReviewCount" SET NOT NULL;

ALTER TABLE public."BlogPost"
  ALTER COLUMN "authorSellerPubliclyOrderable" SET DEFAULT false,
  ALTER COLUMN "authorSellerPubliclyOrderable" SET NOT NULL;

CREATE INDEX "Listing_sellerPubliclyOrderable_status_isPrivate_archivedAt_idx"
  ON public."Listing"(
    "sellerPubliclyOrderable", status, "isPrivate", "archivedAt"
  );

CREATE INDEX "Listing_sellerAverageRating_sellerReviewCount_idx"
  ON public."Listing"("sellerAverageRating", "sellerReviewCount");

CREATE FUNCTION public.grainline_listing_seller_public_state_bind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_listing_seller_public_state_bind$
DECLARE
  source_seller record;
BEGIN
  SELECT seller."displayName",
         seller."displayNameNormalized",
         seller."chargesEnabled",
         seller."stripeAccountSupported",
         seller."vacationMode",
         seller."ownerAccountActive",
         COALESCE(summary."averageRating", 0) AS "averageRating",
         COALESCE(summary."reviewCount", 0) AS "reviewCount"
    INTO source_seller
    FROM public."SellerProfile" AS seller
    LEFT JOIN public."SellerRatingSummary" AS summary
      ON summary."sellerProfileId" = seller.id
   WHERE seller.id = NEW."sellerId"
   FOR SHARE OF seller;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing seller profile is missing'
      USING ERRCODE = '23503';
  END IF;

  NEW."sellerPubliclyOrderable" := (
    source_seller."chargesEnabled" = true
    AND source_seller."stripeAccountSupported" = true
    AND source_seller."vacationMode" = false
    AND source_seller."ownerAccountActive" = true
  );
  NEW."sellerDisplayName" := source_seller."displayName";
  NEW."sellerDisplayNameNormalized" := source_seller."displayNameNormalized";
  NEW."sellerAverageRating" := source_seller."averageRating";
  NEW."sellerReviewCount" := source_seller."reviewCount";
  RETURN NEW;
END
$grainline_listing_seller_public_state_bind$;

CREATE OR REPLACE FUNCTION public.grainline_blog_post_author_public_state_bind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blog_post_author_public_state_bind$
DECLARE
  source_user record;
  source_seller record;
  linked_seller record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."authorId" IS DISTINCT FROM NEW."authorId"
     AND NEW."authorId" IS NOT NULL THEN
    RAISE EXCEPTION 'Blog post author cannot be rebound'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."authorId" IS NULL THEN
    NEW."authorAccountActive" := false;
    NEW."authorName" := NULL;
    NEW."authorImageUrl" := NULL;
    NEW."authorSellerName" := NULL;
    NEW."authorSellerAvatarUrl" := NULL;
    NEW."authorSellerPubliclyOrderable" := false;
    RETURN NEW;
  END IF;

  IF TG_ARGV[0] IN ('all', 'user') THEN
    SELECT account_user.banned, account_user."deletedAt", account_user.name,
           account_user."imageUrl"
      INTO source_user
      FROM public."User" AS account_user
     WHERE account_user.id = NEW."authorId"
     FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Blog post author account is missing'
        USING ERRCODE = '23503';
    END IF;

    NEW."authorAccountActive" := (
      source_user.banned = false AND source_user."deletedAt" IS NULL
    );
    NEW."authorName" := source_user.name;
    NEW."authorImageUrl" := source_user."imageUrl";
  END IF;

  IF TG_ARGV[0] IN ('all', 'seller') THEN
    SELECT seller."displayName", seller."avatarImageUrl"
      INTO source_seller
      FROM public."SellerProfile" AS seller
     WHERE seller."userId" = NEW."authorId"
     FOR SHARE;

    NEW."authorSellerName" := source_seller."displayName";
    NEW."authorSellerAvatarUrl" := source_seller."avatarImageUrl";

    NEW."authorSellerPubliclyOrderable" := false;
    IF NEW."sellerProfileId" IS NOT NULL THEN
      SELECT seller."chargesEnabled",
             seller."stripeAccountSupported",
             seller."vacationMode",
             seller."ownerAccountActive"
        INTO linked_seller
        FROM public."SellerProfile" AS seller
       WHERE seller.id = NEW."sellerProfileId"
       FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Blog post seller profile is missing'
          USING ERRCODE = '23503';
      END IF;

      NEW."authorSellerPubliclyOrderable" := (
        linked_seller."chargesEnabled" = true
        AND linked_seller."stripeAccountSupported" = true
        AND linked_seller."vacationMode" = false
        AND linked_seller."ownerAccountActive" = true
      );
    END IF;
  END IF;
  RETURN NEW;
END
$grainline_blog_post_author_public_state_bind$;

CREATE OR REPLACE FUNCTION public.grainline_seller_public_blog_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_blog_state_sync$
BEGIN
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND OLD."userId" IS DISTINCT FROM NEW."userId") THEN
    UPDATE public."BlogPost" AS post
       SET "authorSellerName" = NULL,
           "authorSellerAvatarUrl" = NULL
     WHERE post."authorId" = OLD."userId"
       AND (
         post."authorSellerName" IS NOT NULL
         OR post."authorSellerAvatarUrl" IS NOT NULL
       );

    UPDATE public."BlogComment" AS comment
       SET "authorSellerProfilePresent" = false,
           "authorSellerAvatarUrl" = NULL
     WHERE comment."authorId" = OLD."userId"
       AND (
         comment."authorSellerProfilePresent" = true
         OR comment."authorSellerAvatarUrl" IS NOT NULL
       );
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE public."BlogPost" AS post
       SET "authorSellerPubliclyOrderable" = false
     WHERE post."sellerProfileId" = OLD.id
       AND post."authorSellerPubliclyOrderable" = true;
    RETURN NULL;
  END IF;

  UPDATE public."Listing" AS listing
     SET "sellerPubliclyOrderable" = (
           NEW."chargesEnabled" = true
           AND NEW."stripeAccountSupported" = true
           AND NEW."vacationMode" = false
           AND NEW."ownerAccountActive" = true
         ),
         "sellerDisplayName" = NEW."displayName",
         "sellerDisplayNameNormalized" = NEW."displayNameNormalized"
   WHERE listing."sellerId" = NEW.id
     AND (
       listing."sellerPubliclyOrderable" IS DISTINCT FROM (
         NEW."chargesEnabled" = true
         AND NEW."stripeAccountSupported" = true
         AND NEW."vacationMode" = false
         AND NEW."ownerAccountActive" = true
       )
       OR listing."sellerDisplayName" IS DISTINCT FROM NEW."displayName"
       OR listing."sellerDisplayNameNormalized" IS DISTINCT FROM NEW."displayNameNormalized"
     );

  UPDATE public."BlogPost" AS post
     SET "authorSellerPubliclyOrderable" = (
           NEW."chargesEnabled" = true
           AND NEW."stripeAccountSupported" = true
           AND NEW."vacationMode" = false
           AND NEW."ownerAccountActive" = true
         )
   WHERE post."sellerProfileId" = NEW.id
     AND post."authorSellerPubliclyOrderable" IS DISTINCT FROM (
       NEW."chargesEnabled" = true
       AND NEW."stripeAccountSupported" = true
       AND NEW."vacationMode" = false
       AND NEW."ownerAccountActive" = true
     );

  UPDATE public."BlogPost" AS post
     SET "authorSellerName" = NEW."displayName",
         "authorSellerAvatarUrl" = NEW."avatarImageUrl"
   WHERE post."authorId" = NEW."userId"
     AND (
       post."authorSellerName" IS DISTINCT FROM NEW."displayName"
       OR post."authorSellerAvatarUrl" IS DISTINCT FROM NEW."avatarImageUrl"
     );

  UPDATE public."BlogComment" AS comment
     SET "authorSellerProfilePresent" = true,
         "authorSellerAvatarUrl" = NEW."avatarImageUrl"
   WHERE comment."authorId" = NEW."userId"
     AND (
       comment."authorSellerProfilePresent" = false
       OR comment."authorSellerAvatarUrl" IS DISTINCT FROM NEW."avatarImageUrl"
     );

  RETURN NULL;
END
$grainline_seller_public_blog_state_sync$;

CREATE FUNCTION public.grainline_seller_rating_listing_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_rating_listing_state_sync$
DECLARE
  target_seller_profile_id text;
  target_average_rating double precision;
  target_review_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_seller_profile_id := OLD."sellerProfileId";
    target_average_rating := 0;
    target_review_count := 0;
  ELSE
    IF TG_OP = 'UPDATE'
       AND OLD."sellerProfileId" IS DISTINCT FROM NEW."sellerProfileId" THEN
      UPDATE public."Listing" AS listing
         SET "sellerAverageRating" = 0,
             "sellerReviewCount" = 0
       WHERE listing."sellerId" = OLD."sellerProfileId"
         AND (
           listing."sellerAverageRating" IS DISTINCT FROM 0
           OR listing."sellerReviewCount" IS DISTINCT FROM 0
         );
    END IF;

    target_seller_profile_id := NEW."sellerProfileId";
    target_average_rating := NEW."averageRating";
    target_review_count := NEW."reviewCount";
  END IF;

  UPDATE public."Listing" AS listing
     SET "sellerAverageRating" = target_average_rating,
         "sellerReviewCount" = target_review_count
   WHERE listing."sellerId" = target_seller_profile_id
     AND (
       listing."sellerAverageRating" IS DISTINCT FROM target_average_rating
       OR listing."sellerReviewCount" IS DISTINCT FROM target_review_count
     );

  RETURN NULL;
END
$grainline_seller_rating_listing_state_sync$;

REVOKE ALL ON FUNCTION public.grainline_listing_seller_public_state_bind()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_blog_post_author_public_state_bind()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_public_blog_state_sync()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
REVOKE ALL ON FUNCTION public.grainline_seller_rating_listing_state_sync()
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

DROP TRIGGER grainline_blog_post_author_public_state_bind
  ON public."BlogPost";
CREATE TRIGGER grainline_blog_post_author_public_state_bind
BEFORE INSERT OR UPDATE OF "authorId", "sellerProfileId"
ON public."BlogPost"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_blog_post_author_public_state_bind('all');

DROP TRIGGER grainline_blog_post_author_seller_state_bind
  ON public."BlogPost";
CREATE TRIGGER grainline_blog_post_author_seller_state_bind
BEFORE UPDATE OF
  "authorSellerName",
  "authorSellerAvatarUrl",
  "authorSellerPubliclyOrderable"
ON public."BlogPost"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_blog_post_author_public_state_bind('seller');

DROP TRIGGER grainline_seller_public_blog_state_sync
  ON public."SellerProfile";
CREATE TRIGGER grainline_seller_public_blog_state_sync
AFTER INSERT OR DELETE OR UPDATE OF
  "userId",
  "displayName",
  "displayNameNormalized",
  "avatarImageUrl",
  "chargesEnabled",
  "stripeAccountSupported",
  "vacationMode",
  "ownerAccountActive"
ON public."SellerProfile"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_public_blog_state_sync();

CREATE TRIGGER grainline_listing_seller_public_state_bind
BEFORE INSERT OR UPDATE OF
  "sellerId",
  "sellerPubliclyOrderable",
  "sellerDisplayName",
  "sellerDisplayNameNormalized",
  "sellerAverageRating",
  "sellerReviewCount"
ON public."Listing"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_listing_seller_public_state_bind();

CREATE TRIGGER grainline_seller_rating_listing_state_sync
AFTER INSERT OR DELETE OR UPDATE OF
  "sellerProfileId",
  "averageRating",
  "reviewCount"
ON public."SellerRatingSummary"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_rating_listing_state_sync();

DO $grainline_seller_public_visibility_postflight$
DECLARE
  accepted_function_count integer;
  accepted_trigger_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
      LEFT JOIN public."SellerRatingSummary" AS summary
        ON summary."sellerProfileId" = seller.id
     WHERE listing."sellerPubliclyOrderable" IS DISTINCT FROM (
             seller."chargesEnabled" = true
             AND seller."stripeAccountSupported" = true
             AND seller."vacationMode" = false
             AND seller."ownerAccountActive" = true
           )
        OR listing."sellerDisplayName" IS DISTINCT FROM seller."displayName"
        OR listing."sellerDisplayNameNormalized" IS DISTINCT FROM seller."displayNameNormalized"
        OR listing."sellerAverageRating" IS DISTINCT FROM COALESCE(summary."averageRating", 0)
        OR listing."sellerReviewCount" IS DISTINCT FROM COALESCE(summary."reviewCount", 0)
  ) OR EXISTS (
    SELECT 1
      FROM public."BlogPost" AS post
      LEFT JOIN public."SellerProfile" AS seller
        ON seller.id = post."sellerProfileId"
     WHERE post."authorSellerPubliclyOrderable" IS DISTINCT FROM (
       seller.id IS NOT NULL
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller."vacationMode" = false
       AND seller."ownerAccountActive" = true
     )
  ) THEN
    RAISE EXCEPTION 'Seller public visibility mirrors are inconsistent';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM pg_catalog.pg_proc AS routine
   WHERE routine.oid IN (
           pg_catalog.to_regprocedure(
             'public.grainline_listing_seller_public_state_bind()'
           ),
           pg_catalog.to_regprocedure(
             'public.grainline_blog_post_author_public_state_bind()'
           ),
           pg_catalog.to_regprocedure(
             'public.grainline_seller_public_blog_state_sync()'
           ),
           pg_catalog.to_regprocedure(
             'public.grainline_seller_rating_listing_state_sync()'
           )
         )
     AND routine.prosecdef
     AND routine.proconfig = ARRAY['search_path=pg_catalog']::text[]
     AND NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime', routine.oid, 'EXECUTE'
     )
     AND NOT pg_catalog.has_function_privilege(
       'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
         ) AS privilege
        WHERE privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
     );
  IF accepted_function_count <> 4 THEN
    RAISE EXCEPTION 'Seller public visibility trigger-function posture drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO accepted_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_row
   WHERE NOT trigger_row.tgisinternal
     AND trigger_row.tgenabled = 'O'
     AND (
       (trigger_row.tgrelid = 'public."Listing"'::pg_catalog.regclass
        AND trigger_row.tgname = 'grainline_listing_seller_public_state_bind'
        AND trigger_row.tgfoid = pg_catalog.to_regprocedure(
          'public.grainline_listing_seller_public_state_bind()'
        ))
       OR (trigger_row.tgrelid = 'public."BlogPost"'::pg_catalog.regclass
        AND trigger_row.tgname IN (
          'grainline_blog_post_author_public_state_bind',
          'grainline_blog_post_author_seller_state_bind'
        )
        AND trigger_row.tgfoid = pg_catalog.to_regprocedure(
          'public.grainline_blog_post_author_public_state_bind()'
        ))
       OR (trigger_row.tgrelid = 'public."SellerProfile"'::pg_catalog.regclass
        AND trigger_row.tgname = 'grainline_seller_public_blog_state_sync'
        AND trigger_row.tgfoid = pg_catalog.to_regprocedure(
          'public.grainline_seller_public_blog_state_sync()'
        ))
       OR (trigger_row.tgrelid = 'public."SellerRatingSummary"'::pg_catalog.regclass
        AND trigger_row.tgname = 'grainline_seller_rating_listing_state_sync'
        AND trigger_row.tgfoid = pg_catalog.to_regprocedure(
          'public.grainline_seller_rating_listing_state_sync()'
        ))
     );
  IF accepted_trigger_count <> 5 THEN
    RAISE EXCEPTION 'Seller public visibility trigger posture drifted';
  END IF;
END
$grainline_seller_public_visibility_postflight$;

COMMIT;
