-- Preparation-only Bucket B service-authority draft. Deliberately outside
-- prisma/migrations. SavedSearch Phase B and runtime credential separation
-- passed production postflight; the remaining Notification gates still bar
-- this draft from merge, deployment, or persistent-database activation.
--
-- Every function is intentionally narrow. The migration owner remains the
-- SECURITY DEFINER owner; grainline_app_runtime receives EXECUTE only and must
-- never receive direct Notification INSERT or DELETE privileges.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_core(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
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
  notification_title text;
  notification_body text;
  notification_link text;
  notification_dedup_key text;
  replay_material text;
BEGIN
  -- The block/source lifecycle protocol depends on each statement observing a
  -- fresh snapshot after a conflicting row lock waits. Reject stale-snapshot
  -- isolation rather than letting a caller weaken those absence checks.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'notification creation requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;

  IF p_notification_id IS NULL
     OR p_notification_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'notification id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_user_id = '' OR pg_catalog.char_length(p_user_id) > 191 THEN
    RAISE EXCEPTION 'notification recipient is invalid' USING ERRCODE = '22023';
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
      'checkout_low_stock',
      'manual_low_stock',
      'guild_admin_action',
      'guild_system_action',
      'listing_admin_review',
      'listing_user_report',
      'admin_account_message',
      'banned_seller_order',
      'order_checkout',
      'order_fulfillment',
      'order_payment',
      'stripe_payout_failure',
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
     OR (p_source_type = 'checkout_low_stock'
         AND p_type <> 'LOW_STOCK')
     OR (p_source_type = 'manual_low_stock'
         AND p_type <> 'LOW_STOCK')
     OR (p_source_type IN ('guild_admin_action', 'guild_system_action')
         AND p_type NOT IN ('VERIFICATION_APPROVED', 'VERIFICATION_REJECTED'))
     OR (p_source_type = 'listing_admin_review'
         AND p_type NOT IN ('LISTING_APPROVED', 'LISTING_REJECTED'))
     OR (p_source_type = 'listing_user_report'
         AND p_type <> 'LISTING_FLAGGED_BY_USER')
     OR (p_source_type IN ('admin_account_message', 'banned_seller_order')
         AND p_type <> 'ACCOUNT_WARNING')
     OR (p_source_type = 'order_checkout'
         AND p_type <> 'NEW_ORDER')
     OR (p_source_type = 'order_fulfillment'
         AND p_type NOT IN ('ORDER_SHIPPED', 'ORDER_DELIVERED'))
     OR (p_source_type = 'order_payment'
         AND p_type NOT IN ('NEW_ORDER', 'REFUND_ISSUED', 'PAYMENT_DISPUTE'))
     OR (p_source_type = 'stripe_payout_failure'
         AND p_type <> 'PAYOUT_FAILED')
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
     AND p_source_type NOT IN (
       'case_system_action',
       'commission_request',
       'checkout_low_stock',
       'manual_low_stock',
       'guild_admin_action',
       'guild_system_action',
       'listing_admin_review',
       'admin_account_message',
       'order_payment',
       'stripe_payout_failure'
     )
     AND (p_related_user_id IS NULL OR p_related_user_id = p_user_id) THEN
    RAISE EXCEPTION 'notification source requires a distinct related user' USING ERRCODE = '22023';
  END IF;

  -- Block and unblock writers take FOR UPDATE on this same sorted User pair.
  -- These compatible FOR SHARE locks serialize the later reciprocal Block
  -- absence checks without deadlocking reverse-direction notification work.
  -- Account deletion also takes a conflicting User lock before notification
  -- cleanup, so its existing lifecycle ordering participates in the protocol.
  PERFORM 1
    FROM public."User" AS notification_user_lock
   WHERE notification_user_lock.id = p_user_id
      OR (
        p_related_user_id IS NOT NULL
        AND p_related_user_id <> p_user_id
        AND p_source_type IS DISTINCT FROM 'banned_seller_order'
        AND notification_user_lock.id = p_related_user_id
      )
   ORDER BY notification_user_lock.id
   FOR SHARE;

  SELECT recipient."notificationPreferences"
    INTO recipient_preferences
    FROM public."User" AS recipient
   WHERE recipient.id = p_user_id
     AND recipient.banned = false
     AND recipient."deletedAt" IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF recipient_preferences -> (p_type::text) = 'false'::jsonb THEN
    RETURN NULL;
  END IF;

  IF p_related_user_id IS NOT NULL
     AND p_related_user_id <> p_user_id
     AND p_source_type <> 'banned_seller_order' THEN
    PERFORM 1
      FROM public."User" AS related_user
     WHERE related_user.id = p_related_user_id
       AND related_user.banned = false
       AND related_user."deletedAt" IS NULL;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  -- Social/content/message/commission notifications honor reciprocal blocks
  -- inside the owner operation. Case, order, payment, inventory, moderation,
  -- and account-safety notices are intentionally excluded because blocking
  -- must not hide transactional, dispute, or safety state.
  IF p_related_user_id IS NOT NULL
     AND p_related_user_id <> p_user_id
     AND p_source_type IN (
       'blog_comment',
       'commission_interest',
       'commission_request',
       'favorite',
       'follow',
       'followed_maker_new_blog',
       'followed_maker_new_listing',
       'message',
       'review',
       'seller_broadcast'
     )
     AND EXISTS (
       SELECT 1
         FROM public."Block" AS source_block
        WHERE (source_block."blockerId" = p_user_id
               AND source_block."blockedId" = p_related_user_id)
           OR (source_block."blockerId" = p_related_user_id
               AND source_block."blockedId" = p_user_id)
     ) THEN
    RETURN NULL;
  END IF;

  -- Source-tagged operations must prove the domain object, actor, recipient,
  -- and public/follower relationship in the same owner-backed operation. The
  -- row locks serialize source deletion or visibility changes with creation.
  IF p_source_type = 'blog_comment' THEN
    SELECT
      '/blog/' || source_post.slug || '#comment-' || source_comment.id,
      pg_catalog.left(
        COALESCE(NULLIF(source_author.name, ''), 'Someone')
        || CASE
          WHEN p_type = 'BLOG_COMMENT_REPLY' THEN ' replied to your comment'
          ELSE ' commented on your post'
        END,
        200
      ),
      pg_catalog.left(source_comment.body, 60)
      INTO notification_link, notification_title, notification_body
      FROM public."BlogComment" AS source_comment
      JOIN public."BlogPost" AS source_post
        ON source_post.id = source_comment."postId"
      JOIN public."User" AS source_author
        ON source_author.id = source_comment."authorId"
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
     FOR SHARE OF source_comment, source_post, source_author;
  ELSIF p_source_type = 'case' THEN
    SELECT
      CASE
        WHEN p_user_id = source_case."buyerId"
          THEN '/dashboard/orders/' || source_case."orderId"
        ELSE '/dashboard/sales/' || source_case."orderId"
      END,
      CASE
        WHEN p_type = 'CASE_OPENED'
          THEN pg_catalog.left(
            COALESCE(NULLIF(source_actor.name, ''), 'A buyer') || ' opened a case',
            200
          )
        WHEN source_case.resolution = 'REFUND_FULL' THEN 'Full refund issued'
        WHEN source_case.resolution = 'REFUND_PARTIAL' THEN 'Partial refund issued'
        ELSE 'Case dismissed'
      END,
      CASE
        WHEN p_type = 'CASE_OPENED'
          THEN pg_catalog.left(source_case.description, 60)
        WHEN source_case.resolution = 'REFUND_FULL'
          THEN 'A full refund has been issued to your original payment method.'
        WHEN source_case.resolution = 'REFUND_PARTIAL'
             AND source_case."refundAmountCents" IS NOT NULL
             AND source_case."refundAmountCents" > 0
          THEN 'A partial refund of '
            || CASE
              WHEN pg_catalog.lower(source_order.currency) = 'usd' THEN '$'
              ELSE pg_catalog.upper(source_order.currency) || ' '
            END
            || pg_catalog.to_char(
              source_case."refundAmountCents"::numeric / 100,
              'FM999999999990.00'
            )
            || ' has been issued to your original payment method.'
        WHEN source_case.resolution = 'REFUND_PARTIAL'
          THEN 'A partial refund has been issued to your original payment method.'
        ELSE 'The case has been reviewed and dismissed.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."Case" AS source_case
      JOIN public."Order" AS source_order
        ON source_order.id = source_case."orderId"
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
     FOR SHARE OF source_case, source_order, source_actor;
  ELSIF p_source_type = 'case_message' THEN
    SELECT
      CASE
        WHEN p_user_id = source_case."buyerId"
          THEN '/dashboard/orders/' || source_case."orderId"
        ELSE '/dashboard/sales/' || source_case."orderId"
      END,
      pg_catalog.left(
        CASE
          WHEN source_author.role IN ('EMPLOYEE', 'ADMIN')
            AND source_message."authorId" <> source_case."sellerId"
            AND (source_case."buyerId" IS NULL
                 OR source_message."authorId" <> source_case."buyerId")
            THEN 'Grainline Staff sent a message in your case'
          ELSE COALESCE(
            NULLIF(source_author.name, ''),
            CASE
              WHEN source_message."authorId" = source_case."buyerId" THEN 'A buyer'
              WHEN source_message."authorId" = source_case."sellerId" THEN 'The seller'
              ELSE 'Someone'
            END
          ) || ' sent a message in your case'
        END,
        200
      ),
      pg_catalog.left(source_message.body, 60)
      INTO notification_link, notification_title, notification_body
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
    SELECT
      CASE
        WHEN p_user_id = source_case."buyerId"
          THEN '/dashboard/orders/' || source_case."orderId"
        ELSE '/dashboard/sales/' || source_case."orderId"
      END,
      CASE
        WHEN source_audit.metadata ->> 'status' = 'RESOLVED' THEN 'Case resolved'
        ELSE 'Case marked resolved'
      END,
      CASE
        WHEN source_audit.metadata ->> 'status' = 'RESOLVED'
          THEN 'The case was resolved after both parties confirmed.'
        ELSE 'The other party marked this case resolved. Confirm resolution or continue the discussion.'
      END
      INTO notification_link, notification_title, notification_body
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
    SELECT
      CASE
        WHEN p_user_id = source_case."buyerId"
          THEN '/dashboard/orders/' || source_case."orderId"
        ELSE '/dashboard/sales/' || source_case."orderId"
      END,
      CASE
        WHEN source_audit.action = 'AUTO_CLOSE_CASE' THEN 'Case closed'
        WHEN p_user_id = source_case."buyerId" THEN 'Case under review'
        ELSE 'Case escalated'
      END,
      CASE
        WHEN source_audit.action = 'AUTO_CLOSE_CASE'
          THEN 'This case was closed automatically after the resolution window expired.'
        WHEN source_audit.metadata ->> 'previousStatus' = 'OPEN'
             AND p_user_id = source_case."buyerId"
          THEN 'The seller did not respond in time, so Grainline staff will review this case.'
        WHEN source_audit.metadata ->> 'previousStatus' = 'OPEN'
          THEN 'This case was escalated to Grainline staff because the response window expired.'
        WHEN p_user_id = source_case."buyerId"
          THEN 'This case has been inactive, so Grainline staff will review it.'
        ELSE 'This case was escalated to Grainline staff after the discussion stalled.'
      END
      INTO notification_link, notification_title, notification_body
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
    SELECT
      '/messages/' || source_conversation.id,
      pg_catalog.left(
        COALESCE(NULLIF(source_seller."displayName", ''), 'A maker')
        || ' is interested in your commission',
        200
      ),
      pg_catalog.left('"' || source_request.title || '" — view the conversation', 1000)
      INTO notification_link, notification_title, notification_body
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
     FOR SHARE OF source_interest, source_request, source_seller, source_conversation;
  ELSIF p_source_type = 'commission_request' THEN
    SELECT
      CASE
        WHEN source_request.status = 'CLOSED' THEN '/commission'
        ELSE '/commission/' || source_request.id
      END,
      CASE source_request.status
        WHEN 'FULFILLED' THEN 'Commission request fulfilled'
        WHEN 'CLOSED' THEN 'Commission request closed'
        ELSE 'Commission request expired'
      END,
      CASE
        WHEN source_request.status = 'FULFILLED'
          THEN 'The request "' || source_request.title || '" has been fulfilled. Thanks for your interest!'
        WHEN source_request.status = 'CLOSED'
          THEN 'The request "' || source_request.title || '" has been closed by the buyer.'
        WHEN p_related_user_id IS NULL
          THEN '"' || pg_catalog.left(source_request.title, 80) || '" is now closed to new maker interest.'
        ELSE '"' || pg_catalog.left(source_request.title, 80) || '" is no longer accepting interest.'
      END
      INTO notification_link, notification_title, notification_body
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
  ELSIF p_source_type = 'checkout_low_stock' THEN
    SELECT
      '/dashboard/inventory',
      pg_catalog.left(source_listing.title || ' is running low', 200),
      'Only ' || source_listing."stockQuantity"::text || ' left in stock'
      INTO notification_link, notification_title, notification_body
      FROM public."OrderItem" AS source_item
      JOIN public."Order" AS source_order
        ON source_order.id = source_item."orderId"
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_item."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."CheckoutStockReservation" AS source_reservation
        ON source_reservation."stripeSessionId" = source_order."stripeSessionId"
     WHERE source_item.id = p_source_id
       AND p_related_user_id IS NULL
       AND source_seller."userId" = p_user_id
       AND source_listing."listingType" = 'IN_STOCK'
       AND source_listing."stockQuantity" > 0
       AND source_listing."stockQuantity" <= 2
       AND source_order."paidAt" IS NOT NULL
       AND source_reservation.status = 'COMPLETED'
       AND source_reservation."reservedItems" @> pg_catalog.jsonb_build_array(
         pg_catalog.jsonb_build_object('listingId', source_listing.id)
       )
     FOR SHARE OF source_item, source_order, source_listing, source_seller, source_reservation;
  ELSIF p_source_type = 'manual_low_stock' THEN
    SELECT
      '/dashboard/listings/' || source_listing.id || '/edit',
      pg_catalog.left(source_audit.metadata ->> 'listingTitle' || ' is running low', 200),
      'Only ' || (source_audit.metadata ->> 'newQuantity') ||
        ' left in stock — consider restocking soon'
      INTO notification_link, notification_title, notification_body
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_audit."targetId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_audit.id = p_source_id
       AND source_audit."actorType" = 'user'
       AND source_audit."actorId" = p_user_id
       AND source_audit.action = 'MANUAL_LISTING_STOCK_LOW'
       AND source_audit."targetType" = 'LISTING'
       AND source_audit.metadata ->> 'listingId' = source_listing.id
       AND source_audit.metadata ->> 'listingTitle' <> ''
       AND source_audit.metadata ->> 'newQuantity' IN ('1', '2')
       AND source_audit.metadata ->> 'mutationKind' IN ('delta', 'absolute')
       AND p_related_user_id IS NULL
       AND source_seller."userId" = p_user_id
     FOR SHARE OF source_audit, source_listing, source_seller;
  ELSIF p_source_type = 'guild_admin_action' THEN
    SELECT
      CASE
        WHEN source_audit.action IN (
          'APPROVE_GUILD_MEMBER',
          'APPROVE_GUILD_MASTER',
          'REINSTATE_GUILD_MEMBER'
        ) THEN '/seller/' || source_seller.id
        ELSE '/dashboard/verification'
      END,
      CASE source_audit.action
        WHEN 'APPROVE_GUILD_MEMBER' THEN 'You are now a Guild Member!'
        WHEN 'REJECT_GUILD_MEMBER' THEN 'Guild Member application update'
        WHEN 'REVOKE_GUILD_MEMBER' THEN 'Guild Member badge revoked'
        WHEN 'APPROVE_GUILD_MASTER' THEN 'You are now a Guild Master!'
        WHEN 'REJECT_GUILD_MASTER' THEN 'Guild Master application update'
        WHEN 'REVOKE_GUILD_MASTER' THEN 'Guild Master badge revoked'
        WHEN 'REINSTATE_GUILD_MEMBER' THEN 'Guild Member badge reinstated'
      END,
      CASE source_audit.action
        WHEN 'APPROVE_GUILD_MEMBER' THEN 'Your Guild Member badge is now live on your profile'
        WHEN 'REJECT_GUILD_MEMBER' THEN COALESCE(source_audit.reason, 'Please review your application')
        WHEN 'REVOKE_GUILD_MEMBER' THEN 'Your Guild Member badge was revoked by Grainline staff.'
        WHEN 'APPROVE_GUILD_MASTER' THEN 'Your Guild Master badge is now live on your profile'
        WHEN 'REJECT_GUILD_MASTER' THEN COALESCE(source_audit.reason, 'Please review your application')
        WHEN 'REVOKE_GUILD_MASTER' THEN 'Your Guild Master badge was revoked. Your Guild Member badge remains active.'
        WHEN 'REINSTATE_GUILD_MEMBER' THEN 'Your Guild Member badge is live again on your profile.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."User" AS source_staff
        ON source_staff.id = source_audit."adminId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_audit."targetId"
      JOIN public."MakerVerification" AS source_verification
        ON source_verification."sellerProfileId" = source_seller.id
     WHERE source_audit.id = p_source_id
       AND source_audit."targetType" = 'SELLER_PROFILE'
       AND source_audit.undone = false
       AND source_audit.action IN (
         'APPROVE_GUILD_MEMBER',
         'REJECT_GUILD_MEMBER',
         'REVOKE_GUILD_MEMBER',
         'APPROVE_GUILD_MASTER',
         'REJECT_GUILD_MASTER',
         'REVOKE_GUILD_MASTER',
         'REINSTATE_GUILD_MEMBER'
       )
       AND source_seller."userId" = p_user_id
       AND p_related_user_id IS NULL
       AND source_staff.banned = false
       AND source_staff."deletedAt" IS NULL
       AND source_staff.role IN ('EMPLOYEE', 'ADMIN')
       AND (source_audit.action <> 'REINSTATE_GUILD_MEMBER' OR source_staff.role = 'ADMIN')
       AND source_verification."reviewedById" = source_audit."adminId"
       AND (
         (source_audit.action IN ('APPROVE_GUILD_MEMBER', 'REINSTATE_GUILD_MEMBER')
          AND source_verification.status = 'APPROVED'
          AND source_seller."guildLevel" = 'GUILD_MEMBER')
         OR
         (source_audit.action IN ('REJECT_GUILD_MEMBER', 'REVOKE_GUILD_MEMBER')
          AND source_verification.status = 'REJECTED'
          AND source_seller."guildLevel" = 'NONE')
         OR
         (source_audit.action = 'APPROVE_GUILD_MASTER'
          AND source_verification.status = 'GUILD_MASTER_APPROVED'
          AND source_seller."guildLevel" = 'GUILD_MASTER')
         OR
         (source_audit.action IN ('REJECT_GUILD_MASTER', 'REVOKE_GUILD_MASTER')
          AND source_verification.status = 'GUILD_MASTER_REJECTED'
          AND source_seller."guildLevel" = 'GUILD_MEMBER')
       )
       AND p_type = CASE
         WHEN source_audit.action IN (
           'APPROVE_GUILD_MEMBER',
           'APPROVE_GUILD_MASTER',
           'REINSTATE_GUILD_MEMBER'
         ) THEN 'VERIFICATION_APPROVED'::public."NotificationType"
         ELSE 'VERIFICATION_REJECTED'::public."NotificationType"
       END
     FOR SHARE OF source_audit, source_staff, source_seller, source_verification;
  ELSIF p_source_type = 'guild_system_action' THEN
    SELECT
      '/dashboard/verification',
      CASE source_audit.action
        WHEN 'WARN_GUILD_MASTER_METRICS' THEN 'Guild Master status at risk'
        WHEN 'AUTO_REVOKE_GUILD_MEMBER' THEN 'Guild Member badge revoked'
        WHEN 'AUTO_REVOKE_GUILD_MASTER' THEN 'Guild Master badge revoked'
      END,
      CASE source_audit.action
        WHEN 'WARN_GUILD_MASTER_METRICS' THEN
          'Your metrics have fallen below Guild Master requirements. You have 30 days to improve before your badge is reviewed. Check your dashboard for details.'
        WHEN 'AUTO_REVOKE_GUILD_MEMBER' THEN source_audit.reason
        WHEN 'AUTO_REVOKE_GUILD_MASTER' THEN
          'Your metrics fell below requirements for two consecutive months. Your Guild Member badge remains active.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_audit."targetId"
      JOIN public."MakerVerification" AS source_verification
        ON source_verification."sellerProfileId" = source_seller.id
     WHERE source_audit.id = p_source_id
       AND source_audit."actorType" = 'cron'
       AND source_audit."targetType" = 'SELLER_PROFILE'
       AND source_audit.action IN (
         'WARN_GUILD_MASTER_METRICS',
         'AUTO_REVOKE_GUILD_MEMBER',
         'AUTO_REVOKE_GUILD_MASTER'
       )
       AND source_audit."actorId" = CASE
         WHEN source_audit.action = 'AUTO_REVOKE_GUILD_MEMBER'
           THEN 'guild-member-check'
         ELSE 'guild-metrics'
       END
       AND source_audit.metadata ->> 'jobName' = source_audit."actorId"
       AND source_audit.metadata ->> 'sellerUserId' = source_seller."userId"
       AND source_seller."userId" = p_user_id
       AND p_related_user_id IS NULL
       AND p_type = 'VERIFICATION_REJECTED'::public."NotificationType"
       AND (source_audit.action <> 'AUTO_REVOKE_GUILD_MEMBER' OR source_audit.reason IS NOT NULL)
       AND (
         (source_audit.action = 'WARN_GUILD_MASTER_METRICS'
          AND source_seller."guildLevel" = 'GUILD_MASTER'
          AND source_verification.status = 'GUILD_MASTER_APPROVED'
          AND source_seller."consecutiveMetricFailures" > 0
          AND source_seller."metricWarningSentAt" IS NOT NULL)
         OR
         (source_audit.action = 'AUTO_REVOKE_GUILD_MEMBER'
          AND source_seller."guildLevel" = 'NONE'
          AND source_verification.status = 'REJECTED')
         OR
         (source_audit.action = 'AUTO_REVOKE_GUILD_MASTER'
          AND source_seller."guildLevel" = 'GUILD_MEMBER'
          AND source_verification.status = 'GUILD_MASTER_REJECTED')
       )
     FOR SHARE OF source_audit, source_seller, source_verification;
  ELSIF p_source_type = 'listing_admin_review' THEN
    SELECT
      CASE source_audit.action
        WHEN 'APPROVE_LISTING' THEN '/listing/' || source_listing.id
        WHEN 'REJECT_LISTING' THEN '/dashboard/listings/' || source_listing.id || '/edit'
      END,
      CASE source_audit.action
        WHEN 'APPROVE_LISTING' THEN 'Listing approved'
        WHEN 'REJECT_LISTING' THEN 'Listing needs changes'
      END,
      CASE source_audit.action
        WHEN 'APPROVE_LISTING' THEN
          CASE source_audit.metadata ->> 'finalStatus'
            WHEN 'SOLD_OUT' THEN 'Your listing "' || source_listing.title
              || '" has been approved. Add stock to make it available to buyers.'
            ELSE 'Your listing "' || source_listing.title
              || '" has been approved and is now live!'
          END
        WHEN 'REJECT_LISTING' THEN 'Your listing "' || source_listing.title
          || '" was not approved. Reason: ' || source_audit.reason
          || '. Please edit and resubmit.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."User" AS source_staff
        ON source_staff.id = source_audit."adminId"
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_audit."targetId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_audit.id = p_source_id
       AND source_audit."targetType" = 'LISTING'
       AND source_audit.undone = false
       AND source_audit.action IN ('APPROVE_LISTING', 'REJECT_LISTING')
       AND source_staff.role IN ('EMPLOYEE', 'ADMIN')
       AND source_staff.banned = false
       AND source_staff."deletedAt" IS NULL
       AND source_seller."userId" = p_user_id
       AND p_related_user_id IS NULL
       AND source_listing."reviewedByAdmin" = true
       AND source_listing."reviewedAt" IS NOT NULL
       AND (
         (source_audit.action = 'APPROVE_LISTING'
          AND source_audit.metadata ->> 'finalStatus' IN ('ACTIVE', 'SOLD_OUT')
          AND p_type = 'LISTING_APPROVED'::public."NotificationType")
         OR
         (source_audit.action = 'REJECT_LISTING'
          AND source_audit.reason IS NOT NULL
          AND source_audit.reason <> ''
          AND p_type = 'LISTING_REJECTED'::public."NotificationType")
       )
     FOR SHARE OF source_audit, source_staff, source_listing, source_seller;
  ELSIF p_source_type = 'listing_user_report' THEN
    SELECT
      '/dashboard/listings/' || source_listing.id || '/edit',
      'Listing report received',
      'A report about one of your listings was received and will be reviewed by Grainline staff.'
      INTO notification_link, notification_title, notification_body
      FROM public."UserReport" AS source_report
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_report."targetId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_report.id = p_source_id
       AND source_report."targetType" = 'LISTING'
       AND source_report."reportedId" = source_seller."userId"
       AND source_report."reportedId" = p_user_id
       AND source_report."reporterId" = p_related_user_id
       AND source_report."reporterId" <> source_report."reportedId"
       AND p_type = 'LISTING_FLAGGED_BY_USER'::public."NotificationType"
     FOR SHARE OF source_report, source_listing, source_seller;
  ELSIF p_source_type = 'admin_account_message' THEN
    SELECT
      '/account',
      pg_catalog.left(source_audit.reason, 200),
      pg_catalog.left(source_audit.metadata ->> 'notificationBody', 1000)
      INTO notification_link, notification_title, notification_body
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."User" AS source_staff
        ON source_staff.id = source_audit."adminId"
     WHERE source_audit.id = p_source_id
       AND source_audit.action = 'SEND_EMAIL'
       AND source_audit."targetType" = 'USER'
       AND source_audit."targetId" = p_user_id
       AND source_audit.undone = false
       AND source_staff.role = 'ADMIN'
       AND source_staff.banned = false
       AND source_staff."deletedAt" IS NULL
       AND source_audit.reason IS NOT NULL
       AND source_audit.reason <> ''
       AND pg_catalog.jsonb_typeof(source_audit.metadata -> 'notificationBody') = 'string'
       AND source_audit.metadata ->> 'notificationBody' <> ''
       AND p_related_user_id IS NULL
       AND p_type = 'ACCOUNT_WARNING'::public."NotificationType"
     FOR SHARE OF source_audit, source_staff;
  ELSIF p_source_type = 'banned_seller_order' THEN
    SELECT
      '/dashboard/orders/' || source_order.id,
      'Order under support review',
      'The maker is currently unavailable. Grainline staff will review the order and next steps.'
      INTO notification_link, notification_title, notification_body
      FROM public."AdminAuditLog" AS source_audit
      JOIN public."User" AS source_staff
        ON source_staff.id = source_audit."adminId"
      JOIN public."User" AS source_banned_seller
        ON source_banned_seller.id = source_audit."targetId"
      JOIN public."Order" AS source_order
        ON source_order.id = pg_catalog.split_part(p_source_id, ':', 2)
     WHERE source_audit.id = pg_catalog.split_part(p_source_id, ':', 1)
       AND p_source_id = source_audit.id || ':' || source_order.id
       AND source_audit.action = 'BAN_USER'
       AND source_audit."targetType" = 'USER'
       AND source_audit.undone = false
       AND source_staff.role IN ('EMPLOYEE', 'ADMIN')
       AND source_staff.banned = false
       AND source_staff."deletedAt" IS NULL
       AND source_banned_seller.banned = true
       AND source_banned_seller."deletedAt" IS NULL
       AND source_order."buyerId" = p_user_id
       AND p_related_user_id = source_banned_seller.id
       AND p_type = 'ACCOUNT_WARNING'::public."NotificationType"
       AND source_order."reviewNeeded" = true
       AND EXISTS (
         SELECT 1
           FROM pg_catalog.jsonb_array_elements(
             COALESCE(source_audit.metadata -> 'flaggedOpenOrders', '[]'::jsonb)
           ) AS flagged_order
          WHERE flagged_order ->> 'id' = source_order.id
            AND flagged_order ->> 'buyerId' = source_order."buyerId"
       )
       AND EXISTS (
         SELECT 1
           FROM public."OrderItem" AS source_item
           JOIN public."Listing" AS source_item_listing
             ON source_item_listing.id = source_item."listingId"
           JOIN public."SellerProfile" AS source_item_seller
             ON source_item_seller.id = source_item_listing."sellerId"
          WHERE source_item."orderId" = source_order.id
            AND source_item_seller."userId" = source_banned_seller.id
       )
     FOR SHARE OF source_audit, source_staff, source_banned_seller, source_order;
  ELSIF p_source_type = 'order_checkout' THEN
    SELECT
      CASE
        WHEN p_user_id = source_order."buyerId"
          THEN '/dashboard/orders/' || source_order.id
        ELSE '/dashboard/sales/' || source_order.id
      END,
      CASE
        WHEN p_user_id = source_order."buyerId" THEN 'Order confirmed!'
        ELSE 'New sale! Congrats!'
      END,
      CASE
        WHEN p_user_id = source_order."buyerId" THEN
          'Your order from ' || COALESCE(source_seller."displayName", 'Maker')
          || ' is being prepared'
        ELSE COALESCE(source_buyer.name, 'A buyer') || ' purchased '
          || COALESCE(source_listing.title, 'an item')
      END
      INTO notification_link, notification_title, notification_body
      FROM public."Order" AS source_order
      JOIN public."User" AS source_buyer
        ON source_buyer.id = source_order."buyerId"
      JOIN public."OrderItem" AS source_item
        ON source_item.id = (
          SELECT candidate_item.id
            FROM public."OrderItem" AS candidate_item
           WHERE candidate_item."orderId" = source_order.id
           ORDER BY candidate_item.id
           LIMIT 1
        )
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_item."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."SystemAuditLog" AS source_audit
        ON source_audit."targetId" = source_order.id
       AND source_audit."targetType" = 'ORDER'
       AND source_audit.action = 'STRIPE_CHECKOUT_ORDER_CREATED'
     WHERE source_order.id = p_source_id
       AND source_order."paidAt" IS NOT NULL
       AND source_order."sellerRefundId" IS NULL
       AND source_audit."actorType" = 'webhook'
       AND source_audit."actorId" IS NOT NULL
       AND source_audit.metadata ->> 'stripeSessionId' = source_order."stripeSessionId"
       AND p_type = 'NEW_ORDER'::public."NotificationType"
       AND (
         (p_user_id = source_order."buyerId"
          AND p_related_user_id = source_seller."userId")
         OR
         (p_user_id = source_seller."userId"
          AND p_related_user_id = source_order."buyerId")
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderItem" AS other_item
           JOIN public."Listing" AS other_listing
             ON other_listing.id = other_item."listingId"
          WHERE other_item."orderId" = source_order.id
            AND other_listing."sellerId" <> source_seller.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderPaymentEvent" AS refund_event
          WHERE refund_event."orderId" = source_order.id
            AND refund_event."eventType" = 'REFUND'
       )
     FOR SHARE OF source_order, source_buyer, source_item, source_listing, source_seller, source_audit;
  ELSIF p_source_type = 'order_fulfillment' THEN
    SELECT
      '/dashboard/orders/' || source_order.id,
      CASE source_audit.metadata ->> 'action'
        WHEN 'shipped' THEN 'Your piece is on its way!'
        WHEN 'picked_up' THEN 'Order picked up!'
        WHEN 'ready_for_pickup' THEN 'Ready for pickup!'
      END,
      CASE source_audit.metadata ->> 'action'
        WHEN 'shipped' THEN CASE
          WHEN COALESCE(source_audit.metadata ->> 'trackingCarrier', '') <> ''
            THEN 'Shipped via ' || (source_audit.metadata ->> 'trackingCarrier')
          ELSE 'Your order has been shipped'
        END
        WHEN 'picked_up' THEN 'Your order has been picked up. Enjoy!'
        WHEN 'ready_for_pickup' THEN 'Your order is ready for pickup.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."Order" AS source_order
        ON source_order.id = source_audit."targetId"
      JOIN public."OrderItem" AS source_item
        ON source_item.id = (
          SELECT candidate_item.id
            FROM public."OrderItem" AS candidate_item
           WHERE candidate_item."orderId" = source_order.id
           ORDER BY candidate_item.id
           LIMIT 1
        )
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_item."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_audit.id = p_source_id
       AND source_audit.action = 'ORDER_FULFILLMENT_TRANSITION'
       AND source_audit."actorType" = 'user'
       AND source_audit."targetType" = 'ORDER'
       AND source_audit."actorId" = source_seller."userId"
       AND source_order."buyerId" = p_user_id
       AND p_related_user_id = source_seller."userId"
       AND source_audit.metadata ->> 'action' IN ('shipped', 'picked_up', 'ready_for_pickup')
       AND source_audit.metadata ->> 'newStatus' = CASE source_audit.metadata ->> 'action'
         WHEN 'shipped' THEN 'SHIPPED'
         WHEN 'picked_up' THEN 'PICKED_UP'
         WHEN 'ready_for_pickup' THEN 'READY_FOR_PICKUP'
       END
       AND p_type = CASE source_audit.metadata ->> 'action'
         WHEN 'picked_up' THEN 'ORDER_DELIVERED'::public."NotificationType"
         ELSE 'ORDER_SHIPPED'::public."NotificationType"
       END
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderItem" AS other_item
           JOIN public."Listing" AS other_listing
             ON other_listing.id = other_item."listingId"
          WHERE other_item."orderId" = source_order.id
            AND other_listing."sellerId" <> source_seller.id
       )
     FOR SHARE OF source_audit, source_order, source_item, source_listing, source_seller;
  ELSIF p_source_type = 'order_payment' THEN
    SELECT
      CASE
        WHEN source_payment.metadata ->> 'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
          THEN '/dashboard/orders/' || source_order.id
        WHEN source_payment."eventType" = 'DISPUTE'
          THEN '/dashboard/sales/' || source_order.id
        ELSE '/dashboard/orders/' || source_order.id
      END,
      CASE
        WHEN source_payment.metadata ->> 'localAction' = 'SELLER_REFUND_RECORDED'
          THEN 'Refund from maker'
        WHEN source_payment.metadata ->> 'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
          THEN 'Payment refunded'
        WHEN source_payment."eventType" = 'DISPUTE'
          THEN 'Payment dispute opened'
      END,
      CASE
        WHEN source_payment.metadata ->> 'localAction' = 'SELLER_REFUND_RECORDED'
          THEN pg_catalog.left(source_payment.metadata ->> 'notificationBody', 1000)
        WHEN source_payment.metadata ->> 'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
          THEN 'This payment was refunded because the checkout was no longer eligible to complete.'
        WHEN source_payment."eventType" = 'DISPUTE'
          THEN 'Stripe reported a dispute for order ' || source_order.id || '.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."OrderPaymentEvent" AS source_payment
      JOIN public."Order" AS source_order
        ON source_order.id = source_payment."orderId"
      JOIN public."OrderItem" AS source_item
        ON source_item.id = (
          SELECT candidate_item.id
            FROM public."OrderItem" AS candidate_item
           WHERE candidate_item."orderId" = source_order.id
           ORDER BY candidate_item.id
           LIMIT 1
        )
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_item."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
     WHERE source_payment."stripeEventId" = p_source_id
       AND (
         (source_payment."eventType" = 'REFUND'
          AND source_payment.metadata ->> 'localAction' = 'SELLER_REFUND_RECORDED'
          AND pg_catalog.jsonb_typeof(source_payment.metadata -> 'notificationBody') = 'string'
          AND source_payment.metadata ->> 'notificationBody' <> ''
          AND source_order."buyerId" = p_user_id
          AND p_related_user_id = source_seller."userId"
          AND p_type = 'REFUND_ISSUED'::public."NotificationType")
         OR
         (source_payment."eventType" = 'REFUND'
          AND source_payment.metadata ->> 'localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'
          AND source_order."buyerId" = p_user_id
          AND p_related_user_id IS NULL
          AND p_type = 'NEW_ORDER'::public."NotificationType")
         OR
         (source_payment."eventType" = 'DISPUTE'
          AND source_payment.metadata ->> 'stripeEventType' = 'charge.dispute.created'
          AND source_seller."userId" = p_user_id
          AND p_related_user_id IS NOT DISTINCT FROM source_order."buyerId"
          AND p_type = 'PAYMENT_DISPUTE'::public."NotificationType"
          AND EXISTS (
            SELECT 1
              FROM public."SystemAuditLog" AS dispute_audit
             WHERE dispute_audit."actorType" = 'webhook'
               AND dispute_audit."actorId" = source_payment."stripeEventId"
               AND dispute_audit.action = 'STRIPE_DISPUTE_RECORDED'
               AND dispute_audit."targetType" = 'ORDER'
               AND dispute_audit."targetId" = source_order.id
               AND dispute_audit.metadata ->> 'disputeSideEffectsApplied' = 'true'
          ))
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public."OrderItem" AS other_item
           JOIN public."Listing" AS other_listing
             ON other_listing.id = other_item."listingId"
          WHERE other_item."orderId" = source_order.id
            AND other_listing."sellerId" <> source_seller.id
       )
     FOR SHARE OF source_payment, source_order, source_item, source_listing, source_seller;
  ELSIF p_source_type = 'stripe_payout_failure' THEN
    SELECT
      '/dashboard/seller',
      'Payout failed',
      CASE
        WHEN COALESCE(source_payout."failureMessage", '') <> ''
          THEN 'Stripe could not complete a payout: '
            || pg_catalog.left(source_payout."failureMessage", 900)
        ELSE 'Stripe could not complete a payout. Review your Stripe account so the payout can be retried.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SellerPayoutEvent" AS source_payout
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_payout."sellerProfileId"
     WHERE source_payout.id = p_source_id
       AND pg_catalog.lower(source_payout.status) = 'failed'
       AND source_payout."stripeEventId" IS NOT NULL
       AND source_seller."userId" = p_user_id
       AND p_related_user_id IS NULL
       AND p_type = 'PAYOUT_FAILED'::public."NotificationType"
     FOR SHARE OF source_payout, source_seller;
  ELSIF p_source_type = 'followed_maker_new_listing' THEN
    SELECT
      '/listing/' || source_listing.id,
      pg_catalog.left(
        'New listing from '
        || COALESCE(NULLIF(source_seller."displayName", ''), 'A maker you follow'),
        200
      ),
      pg_catalog.left(source_listing.title, 1000)
      INTO notification_link, notification_title, notification_body
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
    SELECT
      '/blog/' || source_post.slug,
      pg_catalog.left(
        'New post from '
        || COALESCE(NULLIF(source_seller."displayName", ''), 'A maker you follow'),
        200
      ),
      pg_catalog.left(source_post.title, 1000)
      INTO notification_link, notification_title, notification_body
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
    SELECT
      '/account/feed?broadcast=' || source_broadcast.id,
      pg_catalog.left(
        'Update from '
        || COALESCE(NULLIF(source_seller."displayName", ''), 'A maker you follow'),
        200
      ),
      CASE
        WHEN pg_catalog.char_length(source_broadcast.message) > 100
          THEN pg_catalog.left(source_broadcast.message, 100) || '…'
        ELSE source_broadcast.message
      END
      INTO notification_link, notification_title, notification_body
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
    SELECT
      '/listing/' || source_listing.id,
      pg_catalog.left(
        COALESCE(NULLIF(source_actor.name, ''), 'Someone') || ' hearted your listing',
        200
      ),
      pg_catalog.left(source_listing.title, 1000)
      INTO notification_link, notification_title, notification_body
      FROM public."Favorite" AS source_favorite
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_favorite."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."User" AS source_seller_user
        ON source_seller_user.id = source_seller."userId"
      JOIN public."User" AS source_actor
        ON source_actor.id = source_favorite."userId"
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
     FOR SHARE OF source_favorite, source_listing, source_seller, source_seller_user, source_actor;
  ELSIF p_source_type = 'follow' THEN
    SELECT
      '/dashboard/analytics',
      pg_catalog.left(
        COALESCE(NULLIF(source_actor.name, ''), 'Someone') || ' started following you',
        200
      ),
      'They can now see your new listings and posts in their feed'
      INTO notification_link, notification_title, notification_body
      FROM public."Follow" AS source_follow
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_follow."sellerProfileId"
      JOIN public."User" AS source_actor
        ON source_actor.id = source_follow."followerId"
     WHERE source_follow."sellerProfileId" = p_source_id
       AND source_follow."followerId" = p_related_user_id
       AND source_seller."userId" = p_user_id
     FOR SHARE OF source_follow, source_seller, source_actor;
  ELSIF p_source_type = 'message' THEN
    IF p_type = 'CUSTOM_ORDER_LINK' THEN
      SELECT
        '/listing/' || context_listing.id,
        'Your custom piece is ready to review!',
        pg_catalog.left(context_listing.title || ' - review and purchase', 1000)
        INTO notification_link, notification_title, notification_body
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
       FOR SHARE OF source_message, source_conversation, context_listing, context_seller;
    ELSE
      SELECT
        '/messages/' || source_conversation.id,
        pg_catalog.left(
          COALESCE(
            NULLIF(source_sender.name, ''),
            CASE
              WHEN p_type = 'CUSTOM_ORDER_REQUEST' THEN 'A customer'
              ELSE 'Someone'
            END
          )
          || CASE
            WHEN p_type = 'CUSTOM_ORDER_REQUEST' THEN ' wants a custom piece!'
            ELSE ' sent you a message'
          END,
          200
        ),
        CASE
          WHEN p_type = 'CUSTOM_ORDER_REQUEST'
            THEN pg_catalog.left(source_message.body::jsonb ->> 'description', 60)
          ELSE pg_catalog.left(
            COALESCE(NULLIF(source_message.body, ''), 'Sent an attachment'),
            1000
          )
        END
        INTO notification_link, notification_title, notification_body
        FROM public."Message" AS source_message
        JOIN public."Conversation" AS source_conversation
          ON source_conversation.id = source_message."conversationId"
        JOIN public."User" AS source_sender
          ON source_sender.id = source_message."senderId"
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
       FOR SHARE OF source_message, source_conversation, source_sender;
    END IF;
  ELSIF p_source_type = 'review' THEN
    SELECT
      '/listing/' || source_listing.id || '#reviews',
      pg_catalog.left(
        COALESCE(NULLIF(source_reviewer.name, ''), 'A buyer')
        || ' left you a '
        || CASE
          WHEN source_review."ratingX2" % 2 = 0
            THEN (source_review."ratingX2" / 2)::text
          ELSE pg_catalog.to_char(source_review."ratingX2"::numeric / 2, 'FM9.0')
        END
        || '-star review',
        200
      ),
      pg_catalog.left(source_listing.title, 1000)
      INTO notification_link, notification_title, notification_body
      FROM public."Review" AS source_review
      JOIN public."Listing" AS source_listing
        ON source_listing.id = source_review."listingId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_listing."sellerId"
      JOIN public."User" AS source_reviewer
        ON source_reviewer.id = source_review."reviewerId"
     WHERE source_review.id = p_source_id
       AND source_review."reviewerId" = p_related_user_id
       AND source_seller."userId" = p_user_id
     FOR SHARE OF source_review, source_listing, source_seller, source_reviewer;
  END IF;
  IF p_source_type IS NOT NULL AND NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF notification_title IS NULL
     OR notification_title = ''
     OR notification_body IS NULL THEN
    RAISE EXCEPTION 'derived notification payload is invalid' USING ERRCODE = '22023';
  END IF;

  -- Match the application payload contract without trusting application text.
  -- Legitimate source fields such as staff reasons may exceed the display
  -- bounds, so truncate the database-derived result instead of dropping the
  -- notification after the state transition has already committed.
  notification_title := pg_catalog.left(notification_title, 200);
  notification_body := pg_catalog.left(notification_body, 1000);

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
    notification_title,
    notification_body,
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
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_commission_event$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_inventory_event(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
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
AS $grainline_notification_create_inventory_event$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type NOT IN ('checkout_low_stock', 'manual_low_stock') THEN
    RAISE EXCEPTION 'inventory notification requires a reviewed inventory source'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_inventory_event$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_verification_event(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
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
AS $grainline_notification_create_verification_event$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type NOT IN ('guild_admin_action', 'guild_system_action') THEN
    RAISE EXCEPTION 'verification notification requires a reviewed Guild source'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_verification_event$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_moderation_event(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
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
AS $grainline_notification_create_moderation_event$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type NOT IN ('listing_admin_review', 'listing_user_report') THEN
    RAISE EXCEPTION 'moderation notification requires a reviewed listing source'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_moderation_event$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_account_warning(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
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
AS $grainline_notification_create_account_warning$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type NOT IN ('admin_account_message', 'banned_seller_order') THEN
    RAISE EXCEPTION 'account warning requires a reviewed staff or order source'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_account_warning$;

CREATE OR REPLACE FUNCTION public.grainline_notification_create_order_event(
  p_notification_id text,
  p_user_id text,
  p_type public."NotificationType",
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
AS $grainline_notification_create_order_event$
DECLARE
  notification_id text;
BEGIN
  IF p_source_type NOT IN (
    'order_checkout',
    'order_fulfillment',
    'order_payment',
    'stripe_payout_failure'
  ) THEN
    RAISE EXCEPTION 'order notification requires reviewed commerce evidence'
      USING ERRCODE = '22023';
  END IF;

  SELECT public.grainline_notification_create_core(
    p_notification_id,
    p_user_id,
    p_type,
    p_source_type,
    p_source_id,
    p_related_user_id
  ) INTO notification_id;
  RETURN notification_id;
END;
$grainline_notification_create_order_event$;

-- Back-in-stock is a one-shot claim rather than a generic create call. The
-- durable StockNotification row is locked, every recipient/listing/seller fact
-- is derived under that lock, the optional in-app row is inserted, and the
-- subscription is consumed in this same transaction. A competing worker sees
-- no source row and cannot mint a duplicate or enqueue a second email.
CREATE OR REPLACE FUNCTION public.grainline_notification_claim_back_in_stock(
  p_notification_id text,
  p_restock_audit_id text,
  p_stock_notification_id text
)
RETURNS TABLE(claimed boolean, user_id text, notification_id text)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_notification_claim_back_in_stock$
DECLARE
  source_user_id text;
  source_listing_id text;
  source_seller_user_id text;
  source_listing_title text;
  source_stock_quantity integer;
  source_listing_status text;
  source_listing_type text;
  source_is_private boolean;
  source_charges_enabled boolean;
  source_stripe_account_version text;
  source_vacation_mode boolean;
  source_seller_banned boolean;
  source_seller_deleted_at timestamp(3);
  source_recipient_banned boolean;
  source_recipient_deleted_at timestamp(3);
  source_recipient_preferences jsonb;
  derived_title text;
  derived_body text;
  derived_link text;
  replay_material text;
  derived_dedup_key text;
BEGIN
  claimed := false;
  user_id := NULL;
  notification_id := NULL;

  IF p_notification_id IS NULL
     OR p_notification_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'notification id is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_stock_notification_id IS NULL
     OR p_stock_notification_id = ''
     OR pg_catalog.char_length(p_stock_notification_id) > 191 THEN
    RAISE EXCEPTION 'stock notification source is invalid' USING ERRCODE = '22023';
  END IF;
  IF p_restock_audit_id IS NULL
     OR p_restock_audit_id = ''
     OR pg_catalog.char_length(p_restock_audit_id) > 191 THEN
    RAISE EXCEPTION 'restock transition source is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT
    source_subscription."userId",
    source_subscription."listingId",
    source_seller."userId",
    source_listing.title,
    source_listing."stockQuantity",
    source_listing.status::text,
    source_listing."listingType"::text,
    source_listing."isPrivate",
    source_seller."chargesEnabled",
    source_seller."stripeAccountVersion",
    source_seller."vacationMode",
    source_seller_user.banned,
    source_seller_user."deletedAt",
    source_recipient.banned,
    source_recipient."deletedAt",
    source_recipient."notificationPreferences"
  INTO
    source_user_id,
    source_listing_id,
    source_seller_user_id,
    source_listing_title,
    source_stock_quantity,
    source_listing_status,
    source_listing_type,
    source_is_private,
    source_charges_enabled,
    source_stripe_account_version,
    source_vacation_mode,
    source_seller_banned,
    source_seller_deleted_at,
    source_recipient_banned,
    source_recipient_deleted_at,
    source_recipient_preferences
  FROM public."StockNotification" AS source_subscription
  JOIN public."Listing" AS source_listing
    ON source_listing.id = source_subscription."listingId"
  JOIN public."SellerProfile" AS source_seller
    ON source_seller.id = source_listing."sellerId"
  JOIN public."User" AS source_seller_user
    ON source_seller_user.id = source_seller."userId"
  JOIN public."User" AS source_recipient
    ON source_recipient.id = source_subscription."userId"
  JOIN public."SystemAuditLog" AS source_audit
    ON source_audit.id = p_restock_audit_id
   AND source_audit.action = 'MANUAL_LISTING_RESTOCKED'
   AND source_audit."actorType" = 'user'
   AND source_audit."actorId" = source_seller."userId"
   AND source_audit."targetType" = 'LISTING'
   AND source_audit."targetId" = source_listing.id
   AND source_audit.metadata ->> 'listingId' = source_listing.id
   AND source_audit.metadata ->> 'listingTitle' <> ''
   AND source_audit.metadata ->> 'previousStatus' = 'SOLD_OUT'
   AND source_audit.metadata ->> 'newStatus' = 'ACTIVE'
   AND source_audit.metadata ->> 'newQuantity' ~ '^[1-9][0-9]*$'
   AND source_audit.metadata ->> 'mutationKind' IN ('delta', 'absolute')
   AND source_subscription."createdAt" <= source_audit."createdAt"
  WHERE source_subscription.id = p_stock_notification_id
  FOR UPDATE OF source_subscription
  FOR SHARE OF source_listing, source_seller, source_seller_user, source_recipient, source_audit;

  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Do not consume the subscription if the listing is no longer publicly
  -- purchasable. It remains eligible for a later genuine restock transition.
  IF source_listing_status <> 'ACTIVE'
     OR source_listing_type <> 'IN_STOCK'
     OR source_is_private
     OR COALESCE(source_stock_quantity, 0) <= 0
     OR NOT source_charges_enabled
     OR (source_stripe_account_version IS NOT NULL
         AND source_stripe_account_version <> 'v2')
     OR source_vacation_mode
     OR source_seller_banned
     OR source_seller_deleted_at IS NOT NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;

  -- Match the existing one-shot behavior: invalid recipients and recipients
  -- who disabled the in-app type still consume the stock subscription. Email
  -- preference remains an independent application-side decision after a
  -- successful claim.
  IF source_recipient_banned
     OR source_recipient_deleted_at IS NOT NULL
     OR source_recipient_preferences -> 'BACK_IN_STOCK' = 'false'::jsonb THEN
    DELETE FROM public."StockNotification" AS source_subscription
     WHERE source_subscription.id = p_stock_notification_id;
    claimed := true;
    user_id := source_user_id;
    RETURN NEXT;
    RETURN;
  END IF;

  derived_title := pg_catalog.left(source_listing_title || ' is back in stock!', 200);
  derived_body := 'The piece you saved is available again. Current stock: '
    || source_stock_quantity::text || '.';
  derived_link := '/listing/' || source_listing_id;
  replay_material := pg_catalog.concat_ws(
    pg_catalog.chr(31),
    'grainline-notification-v1',
    source_user_id,
    'BACK_IN_STOCK',
    'manual_restock',
    p_restock_audit_id,
    p_stock_notification_id,
    source_seller_user_id
  );
  derived_dedup_key :=
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
    source_user_id,
    CASE
      WHEN source_seller_user_id = source_user_id THEN NULL
      ELSE source_seller_user_id
    END,
    'BACK_IN_STOCK'::public."NotificationType",
    derived_title,
    derived_body,
    derived_link,
    'manual_restock',
    p_restock_audit_id,
    derived_dedup_key,
    false,
    pg_catalog.clock_timestamp()
  )
  ON CONFLICT ("userId", "type", "dedupKey") DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    SELECT notification.id
      INTO notification_id
      FROM public."Notification" AS notification
     WHERE notification."userId" = source_user_id
       AND notification."type" = 'BACK_IN_STOCK'::public."NotificationType"
       AND notification."dedupKey" = derived_dedup_key;
  END IF;

  IF notification_id IS NULL THEN
    RAISE EXCEPTION 'back-in-stock notification claim did not resolve a row';
  END IF;

  DELETE FROM public."StockNotification" AS source_subscription
   WHERE source_subscription.id = p_stock_notification_id;
  claimed := true;
  user_id := source_user_id;
  RETURN NEXT;
END;
$grainline_notification_claim_back_in_stock$;

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
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_source_fanout(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_social_event(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_message_event(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_case_event(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_commission_event(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_inventory_event(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_verification_event(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_moderation_event(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_account_warning(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_create_order_event(
  text, text, public."NotificationType", text, text, text
) FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_notification_claim_back_in_stock(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
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
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_social_event(
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_message_event(
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_case_event(
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_commission_event(
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_inventory_event(
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_verification_event(
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_moderation_event(
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_account_warning(
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_create_order_event(
  text, text, public."NotificationType", text, text, text
) TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_notification_claim_back_in_stock(text, text, text)
  TO grainline_app_runtime;
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
