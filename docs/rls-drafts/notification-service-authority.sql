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
  p_source_type text,
  p_source_id text,
  p_related_user_id text
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
  notification_link text;
  notification_dedup_key text;
  replay_material text;
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
  IF (p_source_type IS NULL) <> (p_source_id IS NULL) THEN
    RAISE EXCEPTION 'notification source metadata must be paired' USING ERRCODE = '22023';
  END IF;
  IF p_source_type IS NOT NULL AND (
    p_source_type NOT IN (
      'blog_comment',
      'case',
      'case_message',
      'case_resolution_mark',
      'case_system_action',
      'commission_interest',
      'commission_request',
      'favorite',
      'followed_maker_new_blog',
      'followed_maker_new_listing',
      'follow',
      'message',
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
     OR (p_source_type = 'case'
         AND p_type NOT IN ('CASE_OPENED', 'CASE_RESOLVED', 'REFUND_ISSUED'))
     OR (p_source_type = 'case_message'
         AND p_type <> 'CASE_MESSAGE')
     OR (p_source_type IN ('case_resolution_mark', 'case_system_action')
         AND p_type NOT IN ('CASE_MESSAGE', 'CASE_RESOLVED'))
     OR (p_source_type IN ('commission_interest', 'commission_request')
         AND p_type <> 'COMMISSION_INTEREST')
     OR (p_source_type = 'favorite'
         AND p_type <> 'NEW_FAVORITE')
     OR (p_source_type = 'followed_maker_new_blog'
         AND p_type <> 'FOLLOWED_MAKER_NEW_BLOG')
     OR (p_source_type = 'followed_maker_new_listing'
         AND p_type <> 'FOLLOWED_MAKER_NEW_LISTING')
     OR (p_source_type = 'follow'
         AND p_type <> 'NEW_FOLLOWER')
     OR (p_source_type = 'message'
         AND p_type NOT IN ('NEW_MESSAGE', 'CUSTOM_ORDER_REQUEST', 'CUSTOM_ORDER_LINK'))
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
     AND p_source_type NOT IN ('case_system_action', 'commission_request')
     AND (p_related_user_id IS NULL OR p_related_user_id = p_user_id) THEN
    RAISE EXCEPTION 'notification source requires a distinct related user' USING ERRCODE = '22023';
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
    SELECT '/blog/' || source_post.slug || '#comment-' || source_comment.id
      INTO notification_link
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
  ELSIF p_source_type = 'case' THEN
    SELECT CASE
      WHEN p_user_id = source_case."buyerId"
        THEN '/dashboard/orders/' || source_case."orderId"
      ELSE '/dashboard/sales/' || source_case."orderId"
    END
      INTO notification_link
      FROM public."Case" AS source_case
      JOIN public."User" AS source_actor
        ON source_actor.id = p_related_user_id
     WHERE source_case.id = p_source_id
       AND (
         (p_type = 'CASE_OPENED'
          AND source_case."buyerId" = p_related_user_id
          AND source_case."sellerId" = p_user_id)
         OR
         (p_type IN ('CASE_RESOLVED', 'REFUND_ISSUED')
          AND source_case.status = 'RESOLVED'
          AND source_case."buyerId" = p_user_id
          AND source_case."resolvedById" = p_related_user_id
          AND source_actor.role IN ('EMPLOYEE', 'ADMIN')
          AND (
            (p_type = 'REFUND_ISSUED'
             AND source_case.resolution IN ('REFUND_FULL', 'REFUND_PARTIAL'))
            OR
            (p_type = 'CASE_RESOLVED'
             AND source_case.resolution = 'DISMISSED')
          ))
       )
     FOR SHARE OF source_case, source_actor;
  ELSIF p_source_type = 'case_message' THEN
    SELECT CASE
      WHEN p_user_id = source_case."buyerId"
        THEN '/dashboard/orders/' || source_case."orderId"
      ELSE '/dashboard/sales/' || source_case."orderId"
    END
      INTO notification_link
      FROM public."CaseMessage" AS source_message
      JOIN public."Case" AS source_case
        ON source_case.id = source_message."caseId"
      JOIN public."User" AS source_author
        ON source_author.id = source_message."authorId"
     WHERE source_message.id = p_source_id
       AND source_message."authorId" = p_related_user_id
       AND (
         (source_message."authorId" = source_case."buyerId"
          AND p_user_id = source_case."sellerId")
         OR
         (source_message."authorId" = source_case."sellerId"
          AND p_user_id = source_case."buyerId")
         OR
         (source_message."authorId" <> source_case."sellerId"
          AND (source_case."buyerId" IS NULL
               OR source_message."authorId" <> source_case."buyerId")
          AND source_author.role IN ('EMPLOYEE', 'ADMIN')
          AND p_user_id IN (source_case."buyerId", source_case."sellerId"))
       )
     FOR SHARE OF source_message, source_case, source_author;
  ELSIF p_source_type = 'case_resolution_mark' THEN
    SELECT CASE
      WHEN p_user_id = source_case."buyerId"
        THEN '/dashboard/orders/' || source_case."orderId"
      ELSE '/dashboard/sales/' || source_case."orderId"
    END
      INTO notification_link
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."Case" AS source_case
        ON source_case.id = source_audit."targetId"
     WHERE source_audit.id = p_source_id
       AND source_audit.action = 'MARK_CASE_RESOLVED'
       AND source_audit."targetType" = 'CASE'
       AND source_audit."adminId" = p_related_user_id
       AND source_audit.undone = false
       AND source_audit.metadata ->> 'actorKind' = 'user'
       AND source_audit.metadata ->> 'orderId' = source_case."orderId"
       AND source_audit.metadata ->> 'status' IN ('PENDING_CLOSE', 'RESOLVED')
       AND p_type = CASE
         WHEN source_audit.metadata ->> 'status' = 'RESOLVED'
           THEN 'CASE_RESOLVED'::public."NotificationType"
         ELSE 'CASE_MESSAGE'::public."NotificationType"
       END
       AND (
         (source_audit."adminId" = source_case."buyerId"
          AND p_user_id = source_case."sellerId")
         OR
         (source_audit."adminId" = source_case."sellerId"
          AND p_user_id = source_case."buyerId")
       )
     FOR SHARE OF source_audit, source_case;
  ELSIF p_source_type = 'case_system_action' THEN
    SELECT CASE
      WHEN p_user_id = source_case."buyerId"
        THEN '/dashboard/orders/' || source_case."orderId"
      ELSE '/dashboard/sales/' || source_case."orderId"
    END
      INTO notification_link
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."Case" AS source_case
        ON source_case.id = source_audit."targetId"
     WHERE source_audit.id = p_source_id
       AND source_audit."actorType" = 'cron'
       AND source_audit."actorId" = 'case-auto-close'
       AND source_audit."targetType" = 'CASE'
       AND source_audit.metadata ->> 'orderId' = source_case."orderId"
       AND p_related_user_id IS NULL
       AND p_user_id IN (source_case."buyerId", source_case."sellerId")
       AND (
         (source_audit.action = 'AUTO_CLOSE_CASE'
          AND source_audit.metadata ->> 'previousStatus' = 'PENDING_CLOSE'
          AND source_audit.metadata ->> 'newStatus' = 'RESOLVED'
          AND p_type = 'CASE_RESOLVED')
         OR
         (source_audit.action = 'AUTO_ESCALATE_CASE'
          AND source_audit.metadata ->> 'previousStatus' IN ('OPEN', 'IN_DISCUSSION')
          AND source_audit.metadata ->> 'newStatus' = 'UNDER_REVIEW'
          AND p_type = 'CASE_MESSAGE')
       )
     FOR SHARE OF source_audit, source_case;
  ELSIF p_source_type = 'commission_interest' THEN
    SELECT '/messages/' || source_conversation.id
      INTO notification_link
      FROM public."CommissionInterest" AS source_interest
      JOIN public."CommissionRequest" AS source_request
        ON source_request.id = source_interest."commissionRequestId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_interest."sellerProfileId"
      JOIN public."Conversation" AS source_conversation
        ON source_conversation.id = source_interest."conversationId"
     WHERE source_interest.id = p_source_id
       AND source_request."buyerId" = p_user_id
       AND source_seller."userId" = p_related_user_id
       AND (
         (source_conversation."userAId" = p_user_id
          AND source_conversation."userBId" = p_related_user_id)
         OR
         (source_conversation."userBId" = p_user_id
          AND source_conversation."userAId" = p_related_user_id)
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."Block" AS source_block
          WHERE (source_block."blockerId" = p_user_id
                 AND source_block."blockedId" = p_related_user_id)
             OR (source_block."blockerId" = p_related_user_id
                 AND source_block."blockedId" = p_user_id)
       )
     FOR SHARE OF source_interest, source_request, source_seller, source_conversation;
  ELSIF p_source_type = 'commission_request' THEN
    SELECT CASE
      WHEN source_request.status = 'CLOSED' THEN '/commission'
      ELSE '/commission/' || source_request.id
    END
      INTO notification_link
      FROM public."CommissionRequest" AS source_request
     WHERE source_request.id = p_source_id
       AND (
         (source_request.status = 'EXPIRED'
          AND p_user_id = source_request."buyerId"
          AND p_related_user_id IS NULL)
         OR
         (source_request.status IN ('CLOSED', 'FULFILLED', 'EXPIRED')
          AND p_related_user_id = source_request."buyerId"
          AND EXISTS (
            SELECT 1
              FROM public."CommissionInterest" AS source_interest
              JOIN public."SellerProfile" AS source_seller
                ON source_seller.id = source_interest."sellerProfileId"
             WHERE source_interest."commissionRequestId" = source_request.id
               AND source_seller."userId" = p_user_id
          ))
       )
     FOR SHARE OF source_request;
  ELSIF p_source_type = 'followed_maker_new_listing' THEN
    SELECT '/listing/' || source_listing.id
      INTO notification_link
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
    SELECT '/blog/' || source_post.slug
      INTO notification_link
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
    SELECT '/account/feed?broadcast=' || source_broadcast.id
      INTO notification_link
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
    SELECT '/listing/' || source_listing.id
      INTO notification_link
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
    SELECT '/dashboard/analytics'
      INTO notification_link
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
  ELSIF p_source_type = 'message' THEN
    IF p_type = 'CUSTOM_ORDER_LINK' THEN
      SELECT '/listing/' || context_listing.id
        INTO notification_link
        FROM public."Message" AS source_message
        JOIN public."Conversation" AS source_conversation
          ON source_conversation.id = source_message."conversationId"
        JOIN public."Listing" AS context_listing
          ON context_listing.id = pg_catalog.substring(
            source_message.body,
            '"listingId":"([^"]+)"'
          )
         AND context_listing."customOrderConversationId" = source_conversation.id
        JOIN public."SellerProfile" AS context_seller
          ON context_seller.id = context_listing."sellerId"
       WHERE source_message.id = p_source_id
         AND source_message.kind = 'custom_order_link'
         AND source_message."senderId" = p_related_user_id
         AND source_message."recipientId" = p_user_id
         AND context_listing."reservedForUserId" = p_user_id
         AND context_seller."userId" = p_related_user_id
         AND context_listing.status IN ('ACTIVE', 'SOLD_OUT')
         AND (
           (source_conversation."userAId" = p_related_user_id
            AND source_conversation."userBId" = p_user_id)
           OR
           (source_conversation."userBId" = p_related_user_id
            AND source_conversation."userAId" = p_user_id)
         )
         AND NOT EXISTS (
           SELECT 1
             FROM public."Block" AS source_block
            WHERE (source_block."blockerId" = p_user_id
                   AND source_block."blockedId" = p_related_user_id)
               OR (source_block."blockerId" = p_related_user_id
                   AND source_block."blockedId" = p_user_id)
         )
       FOR SHARE OF source_message, source_conversation, context_listing, context_seller;
    ELSE
      SELECT '/messages/' || source_conversation.id
        INTO notification_link
        FROM public."Message" AS source_message
        JOIN public."Conversation" AS source_conversation
          ON source_conversation.id = source_message."conversationId"
       WHERE source_message.id = p_source_id
         AND source_message."senderId" = p_related_user_id
         AND source_message."recipientId" = p_user_id
         AND (
           (source_conversation."userAId" = p_related_user_id
            AND source_conversation."userBId" = p_user_id)
           OR
           (source_conversation."userBId" = p_related_user_id
            AND source_conversation."userAId" = p_user_id)
         )
         AND (
           (p_type = 'CUSTOM_ORDER_REQUEST'
            AND source_message.kind = 'custom_order_request')
           OR
           (p_type = 'NEW_MESSAGE'
            AND source_message.kind IS DISTINCT FROM 'custom_order_request'
            AND source_message.kind IS DISTINCT FROM 'custom_order_link')
         )
         AND NOT EXISTS (
           SELECT 1
             FROM public."Block" AS source_block
            WHERE (source_block."blockerId" = p_user_id
                   AND source_block."blockedId" = p_related_user_id)
               OR (source_block."blockerId" = p_related_user_id
                   AND source_block."blockedId" = p_user_id)
         )
       FOR SHARE OF source_message, source_conversation;
    END IF;
  ELSIF p_source_type = 'review' THEN
    SELECT '/listing/' || source_listing.id || '#reviews'
      INTO notification_link
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

  IF notification_link IS NULL
     OR notification_link = ''
     OR pg_catalog.char_length(notification_link) > 2048
     OR pg_catalog.left(notification_link, 1) <> '/'
     OR pg_catalog.left(notification_link, 2) = '//'
     OR pg_catalog.strpos(notification_link, pg_catalog.chr(92)) > 0
     OR notification_link ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'derived notification link is invalid' USING ERRCODE = '22023';
  END IF;

  replay_material := pg_catalog.concat_ws(
    pg_catalog.chr(31),
    'grainline-notification-v1',
    p_user_id,
    p_type::text,
    p_source_type,
    p_source_id,
    COALESCE(p_related_user_id, '<system>')
  );
  notification_dedup_key :=
    pg_catalog.md5(replay_material)
    || pg_catalog.md5('grainline-notification-v1-secondary' || replay_material);

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
    notification_link,
    p_source_type,
    p_source_id,
    notification_dedup_key,
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
       AND notification."dedupKey" = notification_dedup_key;
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
  p_source_type text,
  p_source_id text,
  p_related_user_id text
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
    p_source_type,
    p_source_id,
    p_related_user_id
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
  p_source_type text,
  p_source_id text,
  p_related_user_id text
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
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_social_event$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_message_event(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
  p_title text,
  p_body text,
  p_source_type text,
  p_source_id text,
  p_related_user_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_create_message_event$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type <> 'message' THEN
    RAISE EXCEPTION 'message notification requires a message source'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_title,
    p_body,
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_message_event$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_case_event(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
  p_title text,
  p_body text,
  p_source_type text,
  p_source_id text,
  p_related_user_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_create_case_event$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type NOT IN (
    'case',
    'case_message',
    'case_resolution_mark',
    'case_system_action'
  ) THEN
    RAISE EXCEPTION 'case notification requires a case source'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_title,
    p_body,
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_case_event$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_commission_event(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
  p_title text,
  p_body text,
  p_source_type text,
  p_source_id text,
  p_related_user_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_create_commission_event$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type NOT IN ('commission_interest', 'commission_request') THEN
    RAISE EXCEPTION 'commission notification requires a commission source'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_title,
    p_body,
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_commission_event$;

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
  text, text, public."NotificationType", text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_source_fanout(
  text, text, public."NotificationType", text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_social_event(
  text, text, public."NotificationType", text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_message_event(
  text, text, public."NotificationType", text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_case_event(
  text, text, public."NotificationType", text, text, text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_commission_event(
  text, text, public."NotificationType", text, text, text, text, text
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
  text, text, public."NotificationType", text, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_social_event(
  text, text, public."NotificationType", text, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_message_event(
  text, text, public."NotificationType", text, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_case_event(
  text, text, public."NotificationType", text, text, text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_commission_event(
  text, text, public."NotificationType", text, text, text, text, text
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
