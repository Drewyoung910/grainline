-- Preparation-only Bucket B service-authority draft. Deliberately outside
-- prisma/migrations and barred from Vercel deployment until SavedSearch Phase B
-- plus runtime credential separation pass production postflight.
--
-- Every function is intentionally narrow. The migration owner remains the
-- SECURITY DEFINER owner; grainline_app_runtime receives EXECUTE only and must
-- never receive direct Notification INSERT or DELETE privileges.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_core(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
  p_title text,
  p_body text,
  p_link text,
  p_source_type text,
  p_source_id text,
  p_related_user_id text,
  p_dedup_key text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_create_core$
DECLARE
  recipient_preferences jsonb;
  notification_id text;
BEGIN
  IF p_notification_id IS NULL
     OR p_notification_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'notification id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'notification recipient is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_title IS NULL OR p_title = '' OR pg_catalog.char_length(p_title) > 200 THEN
    RAISE EXCEPTION 'notification title is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_body IS NULL OR pg_catalog.char_length(p_body) > 1000 THEN
    RAISE EXCEPTION 'notification body is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_link IS NOT NULL AND (
    p_link = ''
    OR pg_catalog.char_length(p_link) > 2048
    OR pg_catalog.left(p_link, 1) <> '/'
    OR pg_catalog.left(p_link, 2) = '//'
    OR pg_catalog.strpos(p_link, pg_catalog.chr(92)) > 0
    OR p_link ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION 'notification link is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_source_type IS NULL) <> (p_source_id IS NULL) THEN
    RAISE EXCEPTION 'notification source metadata must be paired' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NOT NULL AND (
    p_source_type NOT IN (
      'blog_comment',
      'favorite',
      'followed_maker_new_blog',
      'followed_maker_new_listing',
      'follow',
      'review',
      'seller_broadcast'
    )
    OR pg_catalog.char_length(p_source_type) > 80
    OR p_source_id = ''
    OR pg_catalog.char_length(p_source_id) > 191
  ) THEN
    RAISE EXCEPTION 'notification source metadata is invalid' USING ERRCODE = '22023';
  END IF;
  IF (p_source_type = 'blog_comment'
      AND p_type NOT IN ('NEW_BLOG_COMMENT', 'BLOG_COMMENT_REPLY'))
     OR (p_source_type = 'favorite'
         AND p_type <> 'NEW_FAVORITE')
     OR (p_source_type = 'followed_maker_new_blog'
         AND p_type <> 'FOLLOWED_MAKER_NEW_BLOG')
     OR (p_source_type = 'followed_maker_new_listing'
         AND p_type <> 'FOLLOWED_MAKER_NEW_LISTING')
     OR (p_source_type = 'follow'
         AND p_type <> 'NEW_FOLLOWER')
     OR (p_source_type = 'review'
         AND p_type <> 'NEW_REVIEW')
     OR (p_source_type = 'seller_broadcast'
         AND p_type <> 'SELLER_BROADCAST') THEN
    RAISE EXCEPTION 'notification source does not match notification type' USING ERRCODE = '22023';
  END IF;
  IF p_related_user_id IS NOT NULL AND (
    p_related_user_id = '' OR pg_catalog.char_length(p_related_user_id) > 191
  ) THEN
    RAISE EXCEPTION 'notification related user is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NOT NULL
     AND (p_related_user_id IS NULL OR p_related_user_id = p_user_id) THEN
    RAISE EXCEPTION 'notification source requires a distinct related user' USING ERRCODE = '22023';
  END IF;
  IF p_dedup_key IS NULL OR p_dedup_key !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'notification dedup key is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT recipient."notificationPreferences"
    INTO recipient_preferences
    FROM public."User" AS recipient
   WHERE recipient.id = p_user_id
     AND recipient.banned = false
     AND recipient."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF recipient_preferences -> (p_type::text) = 'false'::jsonb THEN
    RETURN NULL;
  END IF;

  IF p_related_user_id IS NOT NULL AND p_related_user_id <> p_user_id THEN
    PERFORM 1
      FROM public."User" AS related_user
     WHERE related_user.id = p_related_user_id
       AND related_user.banned = false
       AND related_user."deletedAt" IS NULL
     FOR SHARE;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Source-tagged operations must prove the domain object, actor, recipient,
  -- and public/follower relationship in the same owner-backed operation. The
  -- row locks serialize source deletion or visibility changes with creation.
  IF p_source_type = 'blog_comment' THEN
    PERFORM 1
      FROM public."BlogComment" AS source_comment
      JOIN public."BlogPost" AS source_post
        ON source_post.id = source_comment."postId"
      LEFT JOIN public."BlogComment" AS parent_comment
        ON parent_comment.id = source_comment."parentId"
     WHERE source_comment.id = p_source_id
       AND source_comment.approved = true
       AND source_comment."authorId" = p_related_user_id
       AND (
         (p_type = 'BLOG_COMMENT_REPLY'
          AND source_comment."parentId" IS NOT NULL
          AND parent_comment."authorId" = p_user_id)
         OR
         (p_type = 'NEW_BLOG_COMMENT'
          AND source_comment."parentId" IS NULL
          AND source_post."authorId" = p_user_id)
       )
     FOR SHARE OF source_comment, source_post;
  ELSIF p_source_type = 'followed_maker_new_listing' THEN
    PERFORM 1
      FROM public."Listing" AS source_listing
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."User" AS source_seller_user
        ON source_seller_user.id = source_seller."userId"
      JOIN public."Follow" AS source_follow
        ON source_follow."sellerProfileId" = source_seller.id
       AND source_follow."followerId" = p_user_id
     WHERE source_listing.id = p_source_id
       AND source_listing.status = 'ACTIVE'
       AND source_listing."isPrivate" = false
       AND source_seller."userId" = p_related_user_id
       AND source_seller."chargesEnabled" = true
       AND source_seller."vacationMode" = false
       AND (source_seller."stripeAccountVersion" IS NULL
            OR source_seller."stripeAccountVersion" = 'v2')
       AND source_seller_user.banned = false
       AND source_seller_user."deletedAt" IS NULL
     FOR SHARE OF source_listing, source_seller, source_seller_user, source_follow;
  ELSIF p_source_type = 'followed_maker_new_blog' THEN
    PERFORM 1
      FROM public."BlogPost" AS source_post
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_post."sellerProfileId"
      JOIN public."User" AS source_seller_user
        ON source_seller_user.id = source_seller."userId"
      JOIN public."Follow" AS source_follow
        ON source_follow."sellerProfileId" = source_seller.id
       AND source_follow."followerId" = p_user_id
     WHERE source_post.id = p_source_id
       AND source_post.status = 'PUBLISHED'
       AND source_post."publishedAt" IS NOT NULL
       AND source_post."publishedAt" <= pg_catalog.clock_timestamp()
       AND source_seller."userId" = p_related_user_id
       AND source_seller."chargesEnabled" = true
       AND source_seller."vacationMode" = false
       AND (source_seller."stripeAccountVersion" IS NULL
            OR source_seller."stripeAccountVersion" = 'v2')
       AND source_seller_user.banned = false
       AND source_seller_user."deletedAt" IS NULL
     FOR SHARE OF source_post, source_seller, source_seller_user, source_follow;
  ELSIF p_source_type = 'seller_broadcast' THEN
    PERFORM 1
      FROM public."SellerBroadcast" AS source_broadcast
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_broadcast."sellerProfileId"
      JOIN public."User" AS source_seller_user
        ON source_seller_user.id = source_seller."userId"
      JOIN public."Follow" AS source_follow
        ON source_follow."sellerProfileId" = source_seller.id
       AND source_follow."followerId" = p_user_id
     WHERE source_broadcast.id = p_source_id
       AND source_seller."userId" = p_related_user_id
       AND source_seller."chargesEnabled" = true
       AND source_seller."vacationMode" = false
       AND (source_seller."stripeAccountVersion" IS NULL
            OR source_seller."stripeAccountVersion" = 'v2')
       AND source_seller_user.banned = false
       AND source_seller_user."deletedAt" IS NULL
     FOR SHARE OF source_broadcast, source_seller, source_seller_user, source_follow;
  ELSIF p_source_type = 'favorite' THEN
    PERFORM 1
      FROM public."Favorite" AS source_favorite
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_favorite."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."User" AS source_seller_user
        ON source_seller_user.id = source_seller."userId"
     WHERE source_favorite."listingId" = p_source_id
       AND source_favorite."userId" = p_related_user_id
       AND source_seller."userId" = p_user_id
       AND source_listing.status IN ('ACTIVE', 'SOLD_OUT')
       AND source_listing."isPrivate" = false
       AND source_seller."chargesEnabled" = true
       AND source_seller."vacationMode" = false
       AND (source_seller."stripeAccountVersion" IS NULL
            OR source_seller."stripeAccountVersion" = 'v2')
       AND source_seller_user.banned = false
       AND source_seller_user."deletedAt" IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public."Block" AS source_block
          WHERE (source_block."blockerId" = p_user_id
                 AND source_block."blockedId" = p_related_user_id)
             OR (source_block."blockerId" = p_related_user_id
                 AND source_block."blockedId" = p_user_id)
       )
     FOR SHARE OF source_favorite, source_listing, source_seller, source_seller_user;
  ELSIF p_source_type = 'follow' THEN
    PERFORM 1
      FROM public."Follow" AS source_follow
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_follow."sellerProfileId"
     WHERE source_follow."sellerProfileId" = p_source_id
       AND source_follow."followerId" = p_related_user_id
       AND source_seller."userId" = p_user_id
       AND NOT EXISTS (
         SELECT 1
           FROM public."Block" AS source_block
          WHERE (source_block."blockerId" = p_user_id
                 AND source_block."blockedId" = p_related_user_id)
             OR (source_block."blockerId" = p_related_user_id
                 AND source_block."blockedId" = p_user_id)
       )
     FOR SHARE OF source_follow, source_seller;
  ELSIF p_source_type = 'review' THEN
    PERFORM 1
      FROM public."Review" AS source_review
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_review."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_review.id = p_source_id
       AND source_review."reviewerId" = p_related_user_id
       AND source_seller."userId" = p_user_id
     FOR SHARE OF source_review, source_listing, source_seller;
  END IF;
  IF p_source_type IS NOT NULL AND NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public."Notification" (
    id,
    "userId",
    "relatedUserId",
    "type",
    title,
    body,
    link,
    "sourceType",
    "sourceId",
    "dedupKey",
    read,
    "createdAt"
  ) VALUES (
    p_notification_id,
    p_user_id,
    p_related_user_id,
    p_type,
    p_title,
    p_body,
    p_link,
    p_source_type,
    p_source_id,
    p_dedup_key,
    false,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT ("userId", "type", "dedupKey") DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT notification.id
      INTO notification_id
      FROM public."Notification" AS notification
     WHERE notification."userId" = p_user_id
       AND notification."type" = p_type
       AND notification."dedupKey" = p_dedup_key;
  END IF;

  RETURN notification_id;
END;
$grainline_notification_create_core$;

-- First granted creation family: the five source-tagged fanout paths whose
-- domain source, actor, recipient, visibility, and follow relationships are
-- validated by the private core. Source-less families get separate wrappers;
-- runtime never receives EXECUTE on the generic fixed-column primitive.
CREATE OR REPLACE FUNCTION public.grainline_notification_create_source_fanout(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
  p_title text,
  p_body text,
  p_link text,
  p_source_type text,
  p_source_id text,
  p_related_user_id text,
  p_dedup_key text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_create_source_fanout$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type NOT IN (
    'blog_comment',
    'followed_maker_new_blog',
    'followed_maker_new_listing',
    'seller_broadcast'
  ) THEN
    RAISE EXCEPTION 'source fanout notification requires a fanout source'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_title,
    p_body,
    p_link,
    p_source_type,
    p_source_id,
    p_related_user_id,
    p_dedup_key
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_source_fanout$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_social_event(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
  p_title text,
  p_body text,
  p_link text,
  p_source_type text,
  p_source_id text,
  p_related_user_id text,
  p_dedup_key text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_create_social_event$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type NOT IN ('favorite', 'follow', 'review') THEN
    RAISE EXCEPTION 'social notification requires a social source'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_title,
    p_body,
    p_link,
    p_source_type,
    p_source_id,
    p_related_user_id,
    p_dedup_key
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_social_event$;

CREATE OR REPLACE FUNCTION public.grainline_notification_delete_for_account(
  p_user_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_delete_for_account$
DECLARE
  request_user_id text := pg_catalog.current_setting('app.user_id', true);
  deleted_count integer;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'account notification cleanup user is invalid' USING ERRCODE = '22023';
  END IF;
  IF request_user_id IS NULL OR request_user_id = '' OR request_user_id <> p_user_id THEN
    RAISE EXCEPTION 'account notification cleanup context mismatch' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE serializes both recipient and related-user creation locks with
  -- lifecycle cleanup, preventing a notification from being inserted after
  -- this delete but before the account transaction marks the user deleted.
  PERFORM 1 FROM public."User" AS account_user WHERE account_user.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account notification cleanup user is missing' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public."Notification" AS notification
   WHERE notification."userId" = p_user_id
      OR notification."relatedUserId" = p_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_notification_delete_for_account$;

CREATE OR REPLACE FUNCTION public.grainline_notification_delete_blog_comment(
  p_comment_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_delete_blog_comment$
DECLARE
  request_user_id text := pg_catalog.current_setting('app.user_id', true);
  deleted_count integer;
BEGIN
  IF p_comment_id IS NULL OR p_comment_id = '' OR pg_catalog.char_length(p_comment_id) > 191 THEN
    RAISE EXCEPTION 'blog comment notification cleanup source is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
    FROM public."User" AS staff_user
   WHERE staff_user.id = request_user_id
     AND staff_user.role::text IN ('EMPLOYEE', 'ADMIN')
     AND staff_user.banned = false
     AND staff_user."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'blog comment notification cleanup requires staff context' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public."BlogComment" AS source_comment WHERE source_comment.id = p_comment_id;
  IF FOUND THEN
    RAISE EXCEPTION 'blog comment notification cleanup requires a deleted source'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public."Notification" AS notification
   WHERE notification."sourceType" = 'blog_comment'
     AND notification."sourceId" = p_comment_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_notification_delete_blog_comment$;

CREATE OR REPLACE FUNCTION public.grainline_notification_delete_seller_broadcast(
  p_broadcast_id text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_delete_seller_broadcast$
DECLARE
  request_user_id text := pg_catalog.current_setting('app.user_id', true);
  deleted_count integer;
BEGIN
  IF p_broadcast_id IS NULL OR p_broadcast_id = '' OR pg_catalog.char_length(p_broadcast_id) > 191 THEN
    RAISE EXCEPTION 'seller broadcast notification cleanup source is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
    FROM public."User" AS staff_user
   WHERE staff_user.id = request_user_id
     AND staff_user.role::text IN ('EMPLOYEE', 'ADMIN')
     AND staff_user.banned = false
     AND staff_user."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'seller broadcast notification cleanup requires staff context' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public."SellerBroadcast" AS source_broadcast WHERE source_broadcast.id = p_broadcast_id;
  IF FOUND THEN
    RAISE EXCEPTION 'seller broadcast notification cleanup requires a deleted source'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public."Notification" AS notification
   WHERE notification."sourceType" = 'seller_broadcast'
     AND notification."sourceId" = p_broadcast_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$grainline_notification_delete_seller_broadcast$;

CREATE OR REPLACE FUNCTION public.grainline_notification_prune_read_batch()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_prune_read_batch$
DECLARE
  deleted_count integer;
BEGIN
  WITH doomed AS (
    SELECT notification.id
      FROM public."Notification" AS notification
     WHERE notification.read = true
       AND notification."createdAt" < pg_catalog.clock_timestamp() - interval '90 days'
     ORDER BY notification."createdAt" ASC, notification.id ASC
     LIMIT 1000
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."Notification" AS notification
     USING doomed
     WHERE notification.id = doomed.id
     RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$grainline_notification_prune_read_batch$;

CREATE OR REPLACE FUNCTION public.grainline_notification_prune_unread_batch()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_prune_unread_batch$
DECLARE
  deleted_count integer;
BEGIN
  WITH doomed AS (
    SELECT notification.id
      FROM public."Notification" AS notification
     WHERE notification.read = false
       AND notification."createdAt" < pg_catalog.clock_timestamp() - interval '365 days'
     ORDER BY notification."createdAt" ASC, notification.id ASC
     LIMIT 1000
     FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM public."Notification" AS notification
     USING doomed
     WHERE notification.id = doomed.id
     RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer INTO deleted_count FROM deleted;
  RETURN deleted_count;
END;
$grainline_notification_prune_unread_batch$;

REVOKE ALL ON FUNCTION public.grainline_notification_create_core(
  text, text, public."NotificationType", text, text, text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_source_fanout(
  text, text, public."NotificationType", text, text, text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_social_event(
  text, text, public."NotificationType", text, text, text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_delete_for_account(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_delete_blog_comment(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_delete_seller_broadcast(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_prune_read_batch()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_prune_unread_batch()
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_notification_create_source_fanout(
  text, text, public."NotificationType", text, text, text, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_social_event(
  text, text, public."NotificationType", text, text, text, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_delete_for_account(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_delete_blog_comment(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_delete_seller_broadcast(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_prune_read_batch()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_prune_unread_batch()
  TO grainline_app_runtime;

-- Direct cross-user table writes remain forbidden. The later policy/grant
-- migration must preserve this posture after every broad provisioning rerun.
REVOKE INSERT, DELETE ON TABLE public."Notification" FROM grainline_app_runtime;

COMMIT;
