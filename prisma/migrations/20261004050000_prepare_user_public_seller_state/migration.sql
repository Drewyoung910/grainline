-- Public seller-domain User-state snapshot preparation.
--
-- The public catalog needs only two facts from the owning User row: whether
-- the account is active and the public profile-image fallback. Keeping those
-- bounded facts on SellerProfile lets existing database-side catalog filters,
-- ordering, pagination and limits survive User RLS without granting runtime
-- broad User SELECT access.
--
-- This migration does not change User rows, User grants, User policies or RLS.

ALTER TABLE public."SellerProfile"
  ADD COLUMN "ownerAccountActive" boolean,
  ADD COLUMN "ownerImageUrl" varchar(2048);

UPDATE public."SellerProfile" AS seller
   SET "ownerAccountActive" = (
         account_user.banned = false
         AND account_user."deletedAt" IS NULL
       ),
       "ownerImageUrl" = account_user."imageUrl"
  FROM public."User" AS account_user
 WHERE account_user.id = seller."userId";

DO $grainline_user_public_seller_state_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."SellerProfile" AS seller
     WHERE seller."ownerAccountActive" IS NULL
  ) THEN
    RAISE EXCEPTION 'Seller owner public state backfill is incomplete';
  END IF;
END
$grainline_user_public_seller_state_backfill$;

ALTER TABLE public."SellerProfile"
  ALTER COLUMN "ownerAccountActive" SET DEFAULT false,
  ALTER COLUMN "ownerAccountActive" SET NOT NULL;

CREATE FUNCTION public.grainline_seller_owner_public_state_bind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_owner_public_state_bind$
DECLARE
  source_user record;
BEGIN
  -- Serialize seller creation/rebinding against concurrent User lifecycle or
  -- image changes so the snapshot cannot commit stale after the User trigger.
  SELECT
    account_user.banned,
    account_user."deletedAt",
    account_user."imageUrl"
    INTO source_user
    FROM public."User" AS account_user
   WHERE account_user.id = NEW."userId"
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller owner account is missing'
      USING ERRCODE = '23503';
  END IF;

  NEW."ownerAccountActive" := (
    source_user.banned = false
    AND source_user."deletedAt" IS NULL
  );
  NEW."ownerImageUrl" := source_user."imageUrl";
  RETURN NEW;
END
$grainline_seller_owner_public_state_bind$;

CREATE FUNCTION public.grainline_user_public_seller_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_public_seller_state_sync$
BEGIN
  UPDATE public."SellerProfile" AS seller
     SET "ownerAccountActive" = (
           NEW.banned = false
           AND NEW."deletedAt" IS NULL
         ),
         "ownerImageUrl" = NEW."imageUrl"
   WHERE seller."userId" = NEW.id
     AND (
       seller."ownerAccountActive" IS DISTINCT FROM (
         NEW.banned = false
         AND NEW."deletedAt" IS NULL
       )
       OR seller."ownerImageUrl" IS DISTINCT FROM NEW."imageUrl"
     );

  RETURN NULL;
END
$grainline_user_public_seller_state_sync$;

REVOKE ALL ON FUNCTION public.grainline_seller_owner_public_state_bind()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_user_public_seller_state_sync()
  FROM PUBLIC;

CREATE TRIGGER grainline_seller_owner_public_state_bind
BEFORE INSERT OR UPDATE OF
  "userId",
  "ownerAccountActive",
  "ownerImageUrl"
ON public."SellerProfile"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_owner_public_state_bind();

CREATE TRIGGER grainline_user_public_seller_state_sync
AFTER UPDATE OF banned, "deletedAt", "imageUrl"
ON public."User"
FOR EACH ROW
WHEN (
  OLD.banned IS DISTINCT FROM NEW.banned
  OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
  OR OLD."imageUrl" IS DISTINCT FROM NEW."imageUrl"
)
EXECUTE FUNCTION public.grainline_user_public_seller_state_sync();

DO $grainline_user_public_seller_state_postflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."SellerProfile" AS seller
      JOIN public."User" AS account_user
        ON account_user.id = seller."userId"
     WHERE seller."ownerAccountActive" IS DISTINCT FROM (
             account_user.banned = false
             AND account_user."deletedAt" IS NULL
           )
        OR seller."ownerImageUrl" IS DISTINCT FROM account_user."imageUrl"
  ) THEN
    RAISE EXCEPTION 'Seller owner public state is inconsistent after preparation';
  END IF;
END
$grainline_user_public_seller_state_postflight$;
