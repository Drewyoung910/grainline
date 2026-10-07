-- Public blog-domain User-state and identity snapshots.
--
-- These bounded fields keep author lifecycle filtering, public labels,
-- ordering, pagination and limits inside the blog domain after User RLS.
-- This migration does not change User rows, grants, policies or RLS.

ALTER TABLE public."BlogPost"
  ADD COLUMN "authorAccountActive" boolean,
  ADD COLUMN "authorName" varchar(100),
  ADD COLUMN "authorImageUrl" varchar(2048),
  ADD COLUMN "authorSellerName" varchar(100),
  ADD COLUMN "authorSellerAvatarUrl" varchar(2048);

ALTER TABLE public."BlogComment"
  ADD COLUMN "authorAccountActive" boolean,
  ADD COLUMN "authorName" varchar(100),
  ADD COLUMN "authorImageUrl" varchar(2048),
  ADD COLUMN "authorSellerProfilePresent" boolean,
  ADD COLUMN "authorSellerAvatarUrl" varchar(2048);

UPDATE public."BlogPost" AS post
   SET "authorAccountActive" = (
         account_user.banned = false
         AND account_user."deletedAt" IS NULL
       ),
       "authorName" = account_user.name,
       "authorImageUrl" = account_user."imageUrl",
       "authorSellerName" = seller."displayName",
       "authorSellerAvatarUrl" = seller."avatarImageUrl"
  FROM public."User" AS account_user
  LEFT JOIN public."SellerProfile" AS seller
    ON seller."userId" = account_user.id
 WHERE account_user.id = post."authorId";

UPDATE public."BlogPost"
   SET "authorAccountActive" = false,
       "authorName" = NULL,
       "authorImageUrl" = NULL,
       "authorSellerName" = NULL,
       "authorSellerAvatarUrl" = NULL
 WHERE "authorId" IS NULL;

UPDATE public."BlogComment" AS comment
   SET "authorAccountActive" = (
         account_user.banned = false
         AND account_user."deletedAt" IS NULL
       ),
       "authorName" = account_user.name,
       "authorImageUrl" = account_user."imageUrl",
       "authorSellerProfilePresent" = seller.id IS NOT NULL,
       "authorSellerAvatarUrl" = seller."avatarImageUrl"
  FROM public."User" AS account_user
  LEFT JOIN public."SellerProfile" AS seller
    ON seller."userId" = account_user.id
 WHERE account_user.id = comment."authorId";

DO $grainline_user_public_blog_state_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."BlogPost"
     WHERE "authorAccountActive" IS NULL
  ) OR EXISTS (
    SELECT 1
      FROM public."BlogComment"
     WHERE "authorAccountActive" IS NULL
  ) THEN
    RAISE EXCEPTION 'Public blog author state backfill is incomplete';
  END IF;
END
$grainline_user_public_blog_state_backfill$;

ALTER TABLE public."BlogPost"
  ALTER COLUMN "authorAccountActive" SET DEFAULT false,
  ALTER COLUMN "authorAccountActive" SET NOT NULL;

ALTER TABLE public."BlogComment"
  ALTER COLUMN "authorAccountActive" SET DEFAULT false,
  ALTER COLUMN "authorAccountActive" SET NOT NULL,
  ALTER COLUMN "authorSellerProfilePresent" SET DEFAULT false,
  ALTER COLUMN "authorSellerProfilePresent" SET NOT NULL;

CREATE FUNCTION public.grainline_blog_post_author_public_state_bind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blog_post_author_public_state_bind$
DECLARE
  source_user record;
  source_seller record;
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
  END IF;
  RETURN NEW;
END
$grainline_blog_post_author_public_state_bind$;

CREATE FUNCTION public.grainline_blog_comment_author_public_state_bind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_blog_comment_author_public_state_bind$
DECLARE
  source_user record;
  source_seller record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."authorId" IS DISTINCT FROM NEW."authorId" THEN
    RAISE EXCEPTION 'Blog comment author cannot be rebound'
      USING ERRCODE = '23514';
  END IF;

  IF TG_ARGV[0] IN ('all', 'user') THEN
    SELECT account_user.banned, account_user."deletedAt", account_user.name,
           account_user."imageUrl"
      INTO source_user
      FROM public."User" AS account_user
     WHERE account_user.id = NEW."authorId"
     FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Blog comment author account is missing'
        USING ERRCODE = '23503';
    END IF;

    NEW."authorAccountActive" := (
      source_user.banned = false AND source_user."deletedAt" IS NULL
    );
    NEW."authorName" := source_user.name;
    NEW."authorImageUrl" := source_user."imageUrl";
  END IF;

  IF TG_ARGV[0] IN ('all', 'seller') THEN
    SELECT seller.id, seller."avatarImageUrl"
      INTO source_seller
      FROM public."SellerProfile" AS seller
     WHERE seller."userId" = NEW."authorId"
     FOR SHARE;

    NEW."authorSellerProfilePresent" := source_seller.id IS NOT NULL;
    NEW."authorSellerAvatarUrl" := source_seller."avatarImageUrl";
  END IF;
  RETURN NEW;
END
$grainline_blog_comment_author_public_state_bind$;

CREATE FUNCTION public.grainline_user_public_blog_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_public_blog_state_sync$
BEGIN
  UPDATE public."BlogPost" AS post
     SET "authorAccountActive" = (
           NEW.banned = false AND NEW."deletedAt" IS NULL
         ),
         "authorName" = NEW.name,
         "authorImageUrl" = NEW."imageUrl"
   WHERE post."authorId" = NEW.id
     AND (
       post."authorAccountActive" IS DISTINCT FROM (
         NEW.banned = false AND NEW."deletedAt" IS NULL
       )
       OR post."authorName" IS DISTINCT FROM NEW.name
       OR post."authorImageUrl" IS DISTINCT FROM NEW."imageUrl"
     );

  UPDATE public."BlogComment" AS comment
     SET "authorAccountActive" = (
           NEW.banned = false AND NEW."deletedAt" IS NULL
         ),
         "authorName" = NEW.name,
         "authorImageUrl" = NEW."imageUrl"
   WHERE comment."authorId" = NEW.id
     AND (
       comment."authorAccountActive" IS DISTINCT FROM (
         NEW.banned = false AND NEW."deletedAt" IS NULL
       )
       OR comment."authorName" IS DISTINCT FROM NEW.name
       OR comment."authorImageUrl" IS DISTINCT FROM NEW."imageUrl"
     );

  RETURN NULL;
END
$grainline_user_public_blog_state_sync$;

CREATE FUNCTION public.grainline_seller_public_blog_state_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_public_blog_state_sync$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."userId" IS DISTINCT FROM NEW."userId") THEN
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

  IF TG_OP <> 'DELETE' THEN
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
  END IF;

  RETURN NULL;
END
$grainline_seller_public_blog_state_sync$;

REVOKE ALL ON FUNCTION public.grainline_blog_post_author_public_state_bind()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_blog_comment_author_public_state_bind()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_user_public_blog_state_sync()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grainline_seller_public_blog_state_sync()
  FROM PUBLIC;

CREATE TRIGGER grainline_blog_post_author_public_state_bind
BEFORE INSERT OR UPDATE OF "authorId"
ON public."BlogPost"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_blog_post_author_public_state_bind('all');

CREATE TRIGGER grainline_blog_post_author_user_state_bind
BEFORE UPDATE OF
  "authorAccountActive",
  "authorName",
  "authorImageUrl"
ON public."BlogPost"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_blog_post_author_public_state_bind('user');

CREATE TRIGGER grainline_blog_post_author_seller_state_bind
BEFORE UPDATE OF
  "authorSellerName",
  "authorSellerAvatarUrl"
ON public."BlogPost"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_blog_post_author_public_state_bind('seller');

CREATE TRIGGER grainline_blog_comment_author_public_state_bind
BEFORE INSERT OR UPDATE OF "authorId"
ON public."BlogComment"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_blog_comment_author_public_state_bind('all');

CREATE TRIGGER grainline_blog_comment_author_user_state_bind
BEFORE UPDATE OF
  "authorAccountActive",
  "authorName",
  "authorImageUrl"
ON public."BlogComment"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_blog_comment_author_public_state_bind('user');

CREATE TRIGGER grainline_blog_comment_author_seller_state_bind
BEFORE UPDATE OF
  "authorSellerProfilePresent",
  "authorSellerAvatarUrl"
ON public."BlogComment"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_blog_comment_author_public_state_bind('seller');

CREATE TRIGGER grainline_user_public_blog_state_sync
AFTER UPDATE OF banned, "deletedAt", name, "imageUrl"
ON public."User"
FOR EACH ROW
WHEN (
  OLD.banned IS DISTINCT FROM NEW.banned
  OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
  OR OLD.name IS DISTINCT FROM NEW.name
  OR OLD."imageUrl" IS DISTINCT FROM NEW."imageUrl"
)
EXECUTE FUNCTION public.grainline_user_public_blog_state_sync();

CREATE TRIGGER grainline_seller_public_blog_state_sync
AFTER INSERT OR DELETE OR UPDATE OF "userId", "displayName", "avatarImageUrl"
ON public."SellerProfile"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_seller_public_blog_state_sync();

DO $grainline_user_public_blog_state_postflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."BlogPost" AS post
      LEFT JOIN public."User" AS account_user ON account_user.id = post."authorId"
      LEFT JOIN public."SellerProfile" AS seller ON seller."userId" = post."authorId"
     WHERE post."authorAccountActive" IS DISTINCT FROM (
             account_user.id IS NOT NULL
             AND account_user.banned = false
             AND account_user."deletedAt" IS NULL
           )
        OR post."authorName" IS DISTINCT FROM account_user.name
        OR post."authorImageUrl" IS DISTINCT FROM account_user."imageUrl"
        OR post."authorSellerName" IS DISTINCT FROM seller."displayName"
        OR post."authorSellerAvatarUrl" IS DISTINCT FROM seller."avatarImageUrl"
  ) OR EXISTS (
    SELECT 1
      FROM public."BlogComment" AS comment
      JOIN public."User" AS account_user ON account_user.id = comment."authorId"
      LEFT JOIN public."SellerProfile" AS seller ON seller."userId" = comment."authorId"
     WHERE comment."authorAccountActive" IS DISTINCT FROM (
             account_user.banned = false
             AND account_user."deletedAt" IS NULL
           )
        OR comment."authorName" IS DISTINCT FROM account_user.name
        OR comment."authorImageUrl" IS DISTINCT FROM account_user."imageUrl"
        OR comment."authorSellerProfilePresent" IS DISTINCT FROM (seller.id IS NOT NULL)
        OR comment."authorSellerAvatarUrl" IS DISTINCT FROM seller."avatarImageUrl"
  ) THEN
    RAISE EXCEPTION 'Public blog author state is inconsistent after preparation';
  END IF;
END
$grainline_user_public_blog_state_postflight$;
