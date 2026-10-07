ALTER TABLE public."Review"
  ADD COLUMN "reviewerAccountActive" boolean,
  ADD COLUMN "reviewerName" varchar(100),
  ADD COLUMN "reviewerImageUrl" varchar(2048);

ALTER TABLE public."CommissionRequest"
  ADD COLUMN "buyerAccountActive" boolean,
  ADD COLUMN "buyerName" varchar(100),
  ADD COLUMN "buyerImageUrl" varchar(2048),
  ADD COLUMN "buyerSellerCity" varchar(100),
  ADD COLUMN "buyerSellerState" varchar(50);

UPDATE public."Review" AS review
   SET "reviewerAccountActive" = (
         account_user.banned = false AND account_user."deletedAt" IS NULL
       ),
       "reviewerName" = account_user.name,
       "reviewerImageUrl" = account_user."imageUrl"
  FROM public."User" AS account_user
 WHERE account_user.id = review."reviewerId";

UPDATE public."CommissionRequest" AS commission
   SET "buyerAccountActive" = (
         account_user.banned = false AND account_user."deletedAt" IS NULL
       ),
       "buyerName" = account_user.name,
       "buyerImageUrl" = account_user."imageUrl",
       "buyerSellerCity" = seller.city,
       "buyerSellerState" = seller.state
  FROM public."User" AS account_user
  LEFT JOIN public."SellerProfile" AS seller
    ON seller."userId" = account_user.id
 WHERE account_user.id = commission."buyerId";

ALTER TABLE public."Review"
  ALTER COLUMN "reviewerAccountActive" SET DEFAULT false,
  ALTER COLUMN "reviewerAccountActive" SET NOT NULL;

ALTER TABLE public."CommissionRequest"
  ALTER COLUMN "buyerAccountActive" SET DEFAULT false,
  ALTER COLUMN "buyerAccountActive" SET NOT NULL;

CREATE FUNCTION public.grainline_review_reviewer_public_state_bind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_review_reviewer_public_state_bind$
DECLARE
  source_user record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."reviewerId" IS DISTINCT FROM NEW."reviewerId" THEN
    RAISE EXCEPTION 'Review reviewer cannot be rebound'
      USING ERRCODE = '23514';
  END IF;

  SELECT account_user.banned, account_user."deletedAt", account_user.name,
         account_user."imageUrl"
    INTO source_user
    FROM public."User" AS account_user
   WHERE account_user.id = NEW."reviewerId"
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review reviewer account is missing'
      USING ERRCODE = '23503';
  END IF;

  NEW."reviewerAccountActive" := (
    source_user.banned = false AND source_user."deletedAt" IS NULL
  );
  NEW."reviewerName" := source_user.name;
  NEW."reviewerImageUrl" := source_user."imageUrl";
  RETURN NEW;
END
$grainline_review_reviewer_public_state_bind$;

CREATE FUNCTION public.grainline_commission_buyer_public_state_bind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_commission_buyer_public_state_bind$
DECLARE
  source_user record;
  source_seller record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."buyerId" IS DISTINCT FROM NEW."buyerId" THEN
    RAISE EXCEPTION 'Commission buyer cannot be rebound'
      USING ERRCODE = '23514';
  END IF;

  IF TG_ARGV[0] IN ('all', 'user') THEN
    SELECT account_user.banned, account_user."deletedAt", account_user.name,
           account_user."imageUrl"
      INTO source_user
      FROM public."User" AS account_user
     WHERE account_user.id = NEW."buyerId"
     FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Commission buyer account is missing'
        USING ERRCODE = '23503';
    END IF;

    NEW."buyerAccountActive" := (
      source_user.banned = false AND source_user."deletedAt" IS NULL
    );
    NEW."buyerName" := source_user.name;
    NEW."buyerImageUrl" := source_user."imageUrl";
  END IF;

  IF TG_ARGV[0] IN ('all', 'seller') THEN
    SELECT seller.city, seller.state
      INTO source_seller
      FROM public."SellerProfile" AS seller
     WHERE seller."userId" = NEW."buyerId"
     FOR SHARE;

    NEW."buyerSellerCity" := source_seller.city;
    NEW."buyerSellerState" := source_seller.state;
  END IF;
  RETURN NEW;
END
$grainline_commission_buyer_public_state_bind$;

CREATE FUNCTION public.grainline_user_public_review_commission_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_public_review_commission_state_sync$
BEGIN
  UPDATE public."Review" AS review
     SET "reviewerAccountActive" = (
           NEW.banned = false AND NEW."deletedAt" IS NULL
         ),
         "reviewerName" = NEW.name,
         "reviewerImageUrl" = NEW."imageUrl"
   WHERE review."reviewerId" = NEW.id
     AND (
       review."reviewerAccountActive" IS DISTINCT FROM (
         NEW.banned = false AND NEW."deletedAt" IS NULL
       )
       OR review."reviewerName" IS DISTINCT FROM NEW.name
       OR review."reviewerImageUrl" IS DISTINCT FROM NEW."imageUrl"
     );

  UPDATE public."CommissionRequest" AS commission
     SET "buyerAccountActive" = (
           NEW.banned = false AND NEW."deletedAt" IS NULL
         ),
         "buyerName" = NEW.name,
         "buyerImageUrl" = NEW."imageUrl"
   WHERE commission."buyerId" = NEW.id
     AND (
       commission."buyerAccountActive" IS DISTINCT FROM (
         NEW.banned = false AND NEW."deletedAt" IS NULL
       )
       OR commission."buyerName" IS DISTINCT FROM NEW.name
       OR commission."buyerImageUrl" IS DISTINCT FROM NEW."imageUrl"
     );

  RETURN NULL;
END
$grainline_user_public_review_commission_state_sync$;

CREATE FUNCTION public.grainline_seller_public_commission_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_commission_state_sync$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."userId" IS DISTINCT FROM NEW."userId") THEN
    UPDATE public."CommissionRequest" AS commission
       SET "buyerSellerCity" = NULL,
           "buyerSellerState" = NULL
     WHERE commission."buyerId" = OLD."userId"
       AND (
         commission."buyerSellerCity" IS NOT NULL
         OR commission."buyerSellerState" IS NOT NULL
       );
  END IF;

  IF TG_OP <> 'DELETE' THEN
    UPDATE public."CommissionRequest" AS commission
       SET "buyerSellerCity" = NEW.city,
           "buyerSellerState" = NEW.state
     WHERE commission."buyerId" = NEW."userId"
       AND (
         commission."buyerSellerCity" IS DISTINCT FROM NEW.city
         OR commission."buyerSellerState" IS DISTINCT FROM NEW.state
       );
  END IF;

  RETURN NULL;
END
$grainline_seller_public_commission_state_sync$;

REVOKE ALL ON FUNCTION public.grainline_review_reviewer_public_state_bind()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_commission_buyer_public_state_bind()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_user_public_review_commission_state_sync()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_seller_public_commission_state_sync()
  FROM PUBLIC;

CREATE TRIGGER grainline_review_reviewer_public_state_bind
BEFORE INSERT OR UPDATE OF "reviewerId"
ON public."Review"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_review_reviewer_public_state_bind();

CREATE TRIGGER grainline_review_reviewer_snapshot_bind
BEFORE UPDATE OF
  "reviewerAccountActive",
  "reviewerName",
  "reviewerImageUrl"
ON public."Review"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_review_reviewer_public_state_bind();

CREATE TRIGGER grainline_commission_buyer_public_state_bind
BEFORE INSERT OR UPDATE OF "buyerId"
ON public."CommissionRequest"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_commission_buyer_public_state_bind('all');

CREATE TRIGGER grainline_commission_buyer_user_state_bind
BEFORE UPDATE OF
  "buyerAccountActive",
  "buyerName",
  "buyerImageUrl"
ON public."CommissionRequest"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_commission_buyer_public_state_bind('user');

CREATE TRIGGER grainline_commission_buyer_seller_state_bind
BEFORE UPDATE OF
  "buyerSellerCity",
  "buyerSellerState"
ON public."CommissionRequest"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_commission_buyer_public_state_bind('seller');

CREATE TRIGGER grainline_user_public_review_commission_state_sync
AFTER UPDATE OF banned, "deletedAt", name, "imageUrl"
ON public."User"
FOR EACH ROW
WHEN (
  OLD.banned IS DISTINCT FROM NEW.banned
  OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
  OR OLD.name IS DISTINCT FROM NEW.name
  OR OLD."imageUrl" IS DISTINCT FROM NEW."imageUrl"
)
EXECUTE FUNCTION public.grainline_user_public_review_commission_state_sync();

CREATE TRIGGER grainline_seller_public_commission_state_sync
AFTER INSERT OR DELETE OR UPDATE OF "userId", city, state
ON public."SellerProfile"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_public_commission_state_sync();

DO $grainline_user_public_review_commission_state_postflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."Review" AS review
      JOIN public."User" AS account_user ON account_user.id = review."reviewerId"
     WHERE review."reviewerAccountActive" IS DISTINCT FROM (
             account_user.banned = false AND account_user."deletedAt" IS NULL
           )
        OR review."reviewerName" IS DISTINCT FROM account_user.name
        OR review."reviewerImageUrl" IS DISTINCT FROM account_user."imageUrl"
  ) OR EXISTS (
    SELECT 1
      FROM public."CommissionRequest" AS commission
      JOIN public."User" AS account_user ON account_user.id = commission."buyerId"
      LEFT JOIN public."SellerProfile" AS seller ON seller."userId" = commission."buyerId"
     WHERE commission."buyerAccountActive" IS DISTINCT FROM (
             account_user.banned = false AND account_user."deletedAt" IS NULL
           )
        OR commission."buyerName" IS DISTINCT FROM account_user.name
        OR commission."buyerImageUrl" IS DISTINCT FROM account_user."imageUrl"
        OR commission."buyerSellerCity" IS DISTINCT FROM seller.city
        OR commission."buyerSellerState" IS DISTINCT FROM seller.state
  ) THEN
    RAISE EXCEPTION 'Public review or commission identity state is inconsistent after preparation';
  END IF;
END
$grainline_user_public_review_commission_state_postflight$;
