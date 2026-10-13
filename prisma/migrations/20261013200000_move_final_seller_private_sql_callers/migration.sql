-- Move the final business-function reads of private seller fields onto the
-- zero-direct companion or the public-safe supported snapshot. Existing
-- signatures, security modes, and grants remain unchanged.

BEGIN;

DO $seller_private_final_callers_preflight$
BEGIN
  IF pg_catalog.to_regclass('public."SellerProfilePrivate"') IS NULL THEN
    RAISE EXCEPTION 'SellerProfilePrivate table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
           'public."SellerProfilePrivate"'::pg_catalog.regclass
       AND attribute.attname IN (
         'stripeAccountId',
         'stripeAccountVersion',
         'consecutiveMetricFailures',
         'metricWarningSentAt'
       )
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     GROUP BY attribute.attrelid
    HAVING pg_catalog.count(*) = 4
  ) THEN
    RAISE EXCEPTION 'SellerProfilePrivate final-caller columns are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'public."SellerProfile"'::pg_catalog.regclass
       AND attribute.attname = 'stripeAccountSupported'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'SellerProfile supported snapshot is missing';
  END IF;
END
$seller_private_final_callers_preflight$;

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

  -- The predecessor application mislabeled blocked-checkout refunds as
  -- NEW_ORDER. Normalize that one legacy input before recipient preferences,
  -- replay identity and storage so an old/new deployment retry cannot create
  -- two rows for one durable refund source. The order_payment source branch
  -- below still proves that only BLOCKED_CHECKOUT_REFUND_RECORDED can use it.
  IF p_source_type = 'order_payment'
     AND p_type = 'NEW_ORDER'::public."NotificationType" THEN
    p_type := 'REFUND_ISSUED'::public."NotificationType";
  END IF;

  IF p_type IS NULL OR (p_source_type = 'blog_comment'
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
    -- PostgreSQL cannot lock the nullable side of the LEFT JOIN below. Lock a
    -- reply and its parent explicitly first so parent deletion/SetNull cannot
    -- invalidate the recipient relationship between validation and insert.
    IF p_type = 'BLOG_COMMENT_REPLY' THEN
      PERFORM 1
        FROM public."BlogComment" AS reply_comment
        JOIN public."BlogComment" AS reply_parent
          ON reply_parent.id = reply_comment."parentId"
       WHERE reply_comment.id = p_source_id
         AND reply_comment.approved = true
         AND reply_comment."authorId" = p_related_user_id
         AND reply_parent."authorId" = p_user_id
       FOR SHARE OF reply_comment, reply_parent;
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;
    END IF;

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
    -- Seller notifications depend on an exact interest/profile relationship.
    -- Lock that evidence rather than relying on an unlocked EXISTS check that
    -- account cleanup could delete concurrently.
    IF p_related_user_id IS NOT NULL THEN
      PERFORM 1
        FROM public."CommissionRequest" AS locked_request
        JOIN public."CommissionInterest" AS locked_interest
          ON locked_interest."commissionRequestId" = locked_request.id
        JOIN public."SellerProfile" AS locked_seller
          ON locked_seller.id = locked_interest."sellerProfileId"
       WHERE locked_request.id = p_source_id
         AND locked_request."buyerId" = p_related_user_id
         AND locked_seller."userId" = p_user_id
       FOR SHARE OF locked_request, locked_interest, locked_seller;
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;
    END IF;

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
      JOIN public."SellerProfilePrivate" AS source_seller_private
        ON source_seller_private."sellerProfileId" = source_seller.id
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
          AND source_seller_private."consecutiveMetricFailures" > 0
          AND source_seller_private."metricWarningSentAt" IS NOT NULL)
         OR
         (source_audit.action = 'AUTO_REVOKE_GUILD_MEMBER'
          AND source_seller."guildLevel" = 'NONE'
          AND source_verification.status = 'REJECTED')
         OR
         (source_audit.action = 'AUTO_REVOKE_GUILD_MASTER'
          AND source_seller."guildLevel" = 'GUILD_MEMBER'
          AND source_verification.status = 'GUILD_MASTER_REJECTED')
       )
     FOR SHARE OF source_audit, source_seller, source_seller_private, source_verification;
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
      CASE
        WHEN source_audit."actorId" = source_order."buyerId"
          THEN '/dashboard/sales/' || source_order.id
        ELSE '/dashboard/orders/' || source_order.id
      END,
      CASE source_audit.metadata ->> 'action'
        WHEN 'shipped' THEN 'Your piece is on its way!'
        WHEN 'ready_for_pickup' THEN 'Ready for pickup!'
        WHEN 'delivered' THEN 'Buyer confirmed delivery'
        WHEN 'picked_up' THEN 'Buyer confirmed pickup'
      END,
      CASE source_audit.metadata ->> 'action'
        WHEN 'shipped' THEN CASE
          WHEN COALESCE(source_audit.metadata ->> 'trackingCarrier', '') <> ''
            THEN 'Shipped via ' || (source_audit.metadata ->> 'trackingCarrier')
          ELSE 'Your order has been shipped'
        END
        WHEN 'ready_for_pickup' THEN 'Your order is ready for pickup.'
        WHEN 'delivered' THEN 'The buyer confirmed delivery.'
        WHEN 'picked_up' THEN 'The buyer confirmed pickup.'
      END
      INTO notification_link, notification_title, notification_body
      FROM public."SystemAuditLog" AS source_audit
      JOIN public."Order" AS source_order
        ON source_order.id = source_audit."targetId"
      JOIN public."SellerProfile" AS source_seller
        ON source_seller.id = source_order."sellerProfileId"
     WHERE source_audit.id = p_source_id
       AND source_audit.action = 'ORDER_FULFILLMENT_TRANSITION'
       AND source_audit."actorType" = 'user'
       AND source_audit."targetType" = 'ORDER'
       AND source_order."paidAt" IS NOT NULL
       AND source_order."sellerRefundId" IS NULL
       AND source_order."paymentRefundBlocked" = false
       AND source_order."paymentOpenDisputeBlocked" = false
       AND (
         (
           source_audit."actorId" = source_seller."userId"
           AND source_order."buyerId" = p_user_id
           AND p_related_user_id = source_seller."userId"
           AND source_audit.metadata ->> 'action' IN ('shipped', 'ready_for_pickup')
           AND source_audit.metadata ->> 'previousStatus' = 'PENDING'
           AND source_audit.metadata ->> 'newStatus' = CASE source_audit.metadata ->> 'action'
             WHEN 'shipped' THEN 'SHIPPED'
             WHEN 'ready_for_pickup' THEN 'READY_FOR_PICKUP'
           END
           AND p_type = 'ORDER_SHIPPED'::public."NotificationType"
         )
         OR
         (
           source_audit."actorId" = source_order."buyerId"
           AND source_seller."userId" = p_user_id
           AND p_related_user_id = source_order."buyerId"
           AND source_audit.metadata ->> 'action' IN ('delivered', 'picked_up')
           AND source_audit.metadata ->> 'fulfillmentMethod' = CASE source_audit.metadata ->> 'action'
             WHEN 'delivered' THEN 'SHIPPING'
             WHEN 'picked_up' THEN 'PICKUP'
           END
           AND source_audit.metadata ->> 'previousStatus' = CASE source_audit.metadata ->> 'action'
             WHEN 'delivered' THEN 'SHIPPED'
             WHEN 'picked_up' THEN 'READY_FOR_PICKUP'
           END
           AND source_audit.metadata ->> 'newStatus' = CASE source_audit.metadata ->> 'action'
             WHEN 'delivered' THEN 'DELIVERED'
             WHEN 'picked_up' THEN 'PICKED_UP'
           END
           AND source_order."fulfillmentMethod"::text = source_audit.metadata ->> 'fulfillmentMethod'
           AND source_order."fulfillmentStatus"::text = source_audit.metadata ->> 'newStatus'
           AND (
             (source_audit.metadata ->> 'action' = 'delivered' AND source_order."deliveredAt" IS NOT NULL)
             OR
             (source_audit.metadata ->> 'action' = 'picked_up' AND source_order."pickedUpAt" IS NOT NULL)
           )
           AND p_type = 'ORDER_DELIVERED'::public."NotificationType"
         )
       )
     FOR SHARE OF source_audit, source_order, source_seller;
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
          -- Compatibility window: predecessor deployments still emit
          -- NEW_ORDER; the corrected application emits REFUND_ISSUED.
          AND p_type IN (
            'NEW_ORDER'::public."NotificationType",
            'REFUND_ISSUED'::public."NotificationType"
          ))
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
       AND source_seller."stripeAccountSupported" = true
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
       AND source_seller."stripeAccountSupported" = true
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
       AND source_seller."stripeAccountSupported" = true
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
       AND source_seller."stripeAccountSupported" = true
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

CREATE OR REPLACE FUNCTION public.grainline_stripe_checkout_order_create(
  p_event_id text,
  p_claim_generation bigint,
  p_reservation_id text,
  p_session_id text,
  p_paid_at timestamp(3) without time zone,
  p_provider jsonb
)
RETURNS TABLE(
  outcome text,
  order_id text,
  invalid_reason text,
  invalid_seller_user_ids text[],
  listing_visibility_changed boolean
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_stripe_checkout_order_create$
DECLARE
  source_event public."StripeWebhookEvent"%ROWTYPE;
  source_reservation public."CheckoutStockReservation"%ROWTYPE;
  source_snapshot jsonb;
  source_items jsonb;
  source_item jsonb;
  provider_item jsonb;
  source_mode text;
  source_seller_id text;
  source_seller_user_id text;
  source_buyer_id text;
  source_listing_id text;
  source_item_key text;
  source_variant_key text;
  source_selected_variants jsonb;
  source_selected_variant_count bigint;
  source_unit_price_cents integer;
  source_quantity integer;
  source_items_subtotal bigint := 0;
  source_max_processing_days integer := 0;
  source_listing_visibility_changed boolean := false;
  source_invalid_reason text := '';
  source_invalid_listing_ids text[] := ARRAY[]::text[];
  source_buyer_invalid_reason text;
  source_seller_invalid_reason text;
  source_listing_invalid_reason text;
  source_review_needed boolean := false;
  source_review_note text;
  source_now timestamp(3) without time zone :=
    pg_catalog.statement_timestamp() AT TIME ZONE 'UTC';
  source_order_id text;
  source_existing_order public."Order"%ROWTYPE;
  source_completion_result text;
  source_paid_item_count integer;
  source_gift_wrapping boolean;
  source_gift_wrapping_price integer;
  source_address_mismatch boolean;
  source_amount_mismatch boolean;
  source_fulfillment_method public."FulfillmentMethod";
  source_processing_deadline timestamp(3) without time zone;
  source_estimated_delivery timestamp(3) without time zone;
  source_listing_snapshot jsonb;
  source_weight double precision;
  source_length double precision;
  source_width double precision;
  source_height double precision;
  source_package_complete boolean;
  source_key_count bigint;
  source_source_key_count bigint;
  source_unknown_key text;
  source_current_buyer record;
  source_current_seller record;
  source_current_listing record;
BEGIN
  IF p_event_id IS NULL
     OR p_event_id !~ '^evt_[A-Za-z0-9_]+$'
     OR pg_catalog.char_length(p_event_id) > 255
     OR p_claim_generation IS NULL
     OR p_claim_generation < 1
     OR p_reservation_id IS NULL
     OR pg_catalog.char_length(p_reservation_id) NOT BETWEEN 1 AND 191
     OR p_session_id IS NULL
     OR p_session_id !~ '^cs_[A-Za-z0-9_]+$'
     OR pg_catalog.char_length(p_session_id) > 255
     OR p_paid_at IS NULL
     -- Keep the fixed writer aligned with the signed-envelope gate. Stripe
     -- permits a manually resent event for 30 days, and the route accepts ten
     -- minutes of positive clock skew. Preserve two minutes beyond the age
     -- gate for the route's bounded 60-second execution plus clock transit; a
     -- narrower database window could accept the envelope and then strand a
     -- paid checkout without an Order.
     OR p_paid_at < source_now - interval '30 days 2 minutes'
     OR p_paid_at > source_now + interval '10 minutes'
     OR p_provider IS NULL
     OR pg_catalog.jsonb_typeof(p_provider) <> 'object'
     OR pg_catalog.pg_column_size(p_provider) > 524288 THEN
    RAISE EXCEPTION 'Paid checkout authority input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT key
    INTO source_unknown_key
    FROM pg_catalog.jsonb_object_keys(p_provider) AS provider_key(key)
   WHERE key <> ALL (ARRAY[
     'currency', 'chargedTotalCents', 'itemsSubtotalCents',
     'shippingTitle', 'shippingAmountCents', 'taxAmountCents',
     'buyerEmail', 'buyerName',
     'shipToLine1', 'shipToLine2', 'shipToCity', 'shipToState',
     'shipToPostalCode', 'shipToCountry',
     'stripePaymentIntentId', 'stripeChargeId',
     'stripeApplicationFeeId', 'stripeTransferId',
     'shippingCarrier', 'shippingService',
     'quotedToLine1', 'quotedToLine2', 'quotedToCity', 'quotedToState',
     'quotedToPostalCode', 'quotedToCountry', 'quotedToName', 'quotedToPhone',
     'quotedShippingAmountCents', 'shippoShipmentId', 'shippoRateObjectId',
     'giftNote', 'giftWrapping', 'giftWrappingPriceCents', 'estDays',
     'paidItems'
   ])
   LIMIT 1;
  IF source_unknown_key IS NOT NULL
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_provider)) <> 36
     OR pg_catalog.jsonb_typeof(p_provider->'paidItems') <> 'array'
     OR pg_catalog.jsonb_array_length(p_provider->'paidItems') NOT BETWEEN 1 AND 50
     OR p_provider->>'currency' !~ '^[a-z]{3}$'
     OR p_provider->>'chargedTotalCents' !~ '^[1-9][0-9]{0,9}$'
     OR p_provider->>'itemsSubtotalCents' !~ '^[0-9]{1,10}$'
     OR p_provider->>'shippingAmountCents' !~ '^[0-9]{1,10}$'
     OR p_provider->>'taxAmountCents' !~ '^[0-9]{1,10}$'
     OR p_provider->>'giftWrappingPriceCents' !~ '^[0-9]{1,10}$'
     OR (
       p_provider->'quotedShippingAmountCents' <> 'null'::jsonb
       AND p_provider->>'quotedShippingAmountCents' !~ '^[0-9]{1,10}$'
     )
     OR p_provider->>'estDays' !~ '^[1-9][0-9]?$'
     OR (p_provider->>'estDays')::integer NOT BETWEEN 1 AND 60
     OR pg_catalog.jsonb_typeof(p_provider->'giftWrapping') <> 'boolean'
     OR p_provider->>'stripePaymentIntentId' !~ '^pi_[A-Za-z0-9_]+$'
     OR p_provider->>'stripeChargeId' !~ '^ch_[A-Za-z0-9_]+$'
     OR p_provider->>'stripeTransferId' !~ '^tr_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'Paid checkout provider projection is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Nullable provider strings must be JSON null or bounded strings. Required
  -- payment references above deliberately wait out Stripe consistency rather
  -- than creating an Order that can never be safely refunded.
  IF (p_provider->'stripeApplicationFeeId' <> 'null'::jsonb AND (
        pg_catalog.jsonb_typeof(p_provider->'stripeApplicationFeeId') <> 'string'
        OR p_provider->>'stripeApplicationFeeId' !~ '^fee_[A-Za-z0-9_]+$'
        OR pg_catalog.char_length(p_provider->>'stripeApplicationFeeId') > 255
      ))
     OR EXISTS (
       SELECT 1
         FROM (VALUES
           ('shippingTitle', 200), ('buyerEmail', 254), ('buyerName', 200),
           ('shipToLine1', 200), ('shipToLine2', 200), ('shipToCity', 100),
           ('shipToState', 50), ('shipToPostalCode', 20), ('shipToCountry', 2),
           ('shippingCarrier', 100), ('shippingService', 100),
           ('quotedToLine1', 200), ('quotedToLine2', 200),
           ('quotedToCity', 100), ('quotedToState', 50),
           ('quotedToPostalCode', 20), ('quotedToCountry', 2),
           ('quotedToName', 200), ('quotedToPhone', 30),
           ('shippoShipmentId', 255), ('shippoRateObjectId', 255),
           ('giftNote', 500)
         ) AS bound(field_name, max_length)
        WHERE p_provider->bound.field_name <> 'null'::jsonb
          AND (
            pg_catalog.jsonb_typeof(p_provider->bound.field_name) <> 'string'
            OR pg_catalog.char_length(p_provider->>bound.field_name) > bound.max_length
          )
     ) THEN
    RAISE EXCEPTION 'Paid checkout provider string is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_provider->>'chargedTotalCents')::bigint > 2147483647
     OR (p_provider->>'itemsSubtotalCents')::bigint > 2147483647
     OR (p_provider->>'shippingAmountCents')::bigint > 2147483647
     OR (p_provider->>'taxAmountCents')::bigint > 2147483647
     OR (p_provider->>'giftWrappingPriceCents')::bigint > 2147483647
     OR (p_provider->>'chargedTotalCents')::bigint <>
        (p_provider->>'itemsSubtotalCents')::bigint
        + (p_provider->>'shippingAmountCents')::bigint
        + (p_provider->>'taxAmountCents')::bigint
        + (p_provider->>'giftWrappingPriceCents')::bigint THEN
    RAISE EXCEPTION 'Paid checkout amount projection is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT event.*
    INTO source_event
    FROM public."StripeWebhookEvent" AS event
   WHERE event.id = p_event_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_event.type::text NOT IN (
       'checkout.session.completed',
       'checkout.session.async_payment_succeeded'
     )
     OR source_event."sourceObjectId" IS DISTINCT FROM p_session_id
     OR source_event."claimGeneration" IS DISTINCT FROM p_claim_generation
     OR source_event."processingStartedAt" IS NULL
     OR source_event."processedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Paid checkout event authority is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Match every CheckoutStockReservation transition's Session lock order:
  -- verified webhook event -> Session advisory lock -> reservation row.
  -- In particular, repair finalization already takes the Session lock before
  -- the reservation row; reversing that order here can deadlock a paid
  -- delivery against its concurrent PAID_OR_COMPLETE repair.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    913337,
    pg_catalog.hashtext(p_session_id)
  );

  SELECT reservation.*
    INTO source_reservation
    FROM public."CheckoutStockReservation" AS reservation
   WHERE reservation.id = p_reservation_id
   FOR UPDATE;
  IF NOT FOUND
     OR source_reservation."stripeSessionId" IS DISTINCT FROM p_session_id
     OR source_reservation.status NOT IN ('SESSION_CREATED', 'COMPLETED')
     OR source_reservation."buyerId" IS NULL
     OR source_reservation."sellerId" IS NULL
     OR source_reservation."sourceSnapshot" IS NULL THEN
    RAISE EXCEPTION 'Paid checkout reservation authority is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  source_snapshot := source_reservation."sourceSnapshot";
  source_buyer_id := source_reservation."buyerId";
  source_seller_id := source_reservation."sellerId";
  source_seller_user_id := source_snapshot#>>'{seller,userId}';
  IF source_snapshot#>>'{seller,id}' IS DISTINCT FROM source_seller_id
     OR source_seller_user_id IS NULL
     OR source_seller_user_id = source_buyer_id
     OR source_snapshot#>>'{seller,stripeAccountId}' IS NULL THEN
    RAISE EXCEPTION 'Paid checkout retained source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  IF pg_catalog.jsonb_typeof(source_snapshot->'items') = 'array'
     AND NOT (source_snapshot ? 'item') THEN
    source_mode := 'cart';
    source_items := source_snapshot->'items';
  ELSIF pg_catalog.jsonb_typeof(source_snapshot->'item') = 'object'
        AND NOT (source_snapshot ? 'items') THEN
    source_mode := 'single';
    source_items := pg_catalog.jsonb_build_array(source_snapshot->'item');
  ELSE
    RAISE EXCEPTION 'Paid checkout retained source mode is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  source_max_processing_days := CASE WHEN source_mode = 'cart' THEN 3 ELSE 0 END;
  IF pg_catalog.jsonb_array_length(source_items) NOT BETWEEN 1 AND 50
     OR pg_catalog.jsonb_array_length(source_items) <>
        pg_catalog.jsonb_array_length(p_provider->'paidItems') THEN
    RAISE EXCEPTION 'Paid checkout retained item count is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lock actors in identifier order before the SellerProfile and Listing
  -- rows. This matches account deletion and checkout reservation lock order.
  PERFORM actor.id
    FROM public."User" AS actor
   WHERE actor.id IN (source_buyer_id, source_seller_user_id)
   ORDER BY actor.id
   FOR UPDATE;

  SELECT buyer.id, buyer.banned, buyer."deletedAt"
    INTO source_current_buyer
    FROM public."User" AS buyer
   WHERE buyer.id = source_buyer_id;
  IF NOT FOUND THEN
    source_buyer_invalid_reason := 'Buyer account could not be verified at payment completion.';
  ELSIF source_current_buyer.banned THEN
    source_buyer_invalid_reason := 'Buyer account was suspended before payment completion.';
  ELSIF source_current_buyer."deletedAt" IS NOT NULL THEN
    source_buyer_invalid_reason := 'Buyer account was deleted before payment completion.';
  ELSIF EXISTS (
    SELECT 1
      FROM public."Block" AS source_block
     WHERE (source_block."blockerId" = source_buyer_id
            AND source_block."blockedId" = source_seller_user_id)
        OR (source_block."blockerId" = source_seller_user_id
            AND source_block."blockedId" = source_buyer_id)
  ) THEN
    source_buyer_invalid_reason :=
      'Buyer and seller could not transact at payment completion.';
  END IF;

  SELECT seller.id, seller."userId", seller."chargesEnabled",
         seller_private."stripeAccountId",
         seller_private."stripeAccountVersion",
         seller."vacationMode",
         seller."acceptingNewOrders", seller_user.banned AS user_banned,
         seller_user."deletedAt" AS user_deleted_at
    INTO source_current_seller
    FROM public."SellerProfile" AS seller
    JOIN public."SellerProfilePrivate" AS seller_private
      ON seller_private."sellerProfileId" = seller.id
    JOIN public."User" AS seller_user ON seller_user.id = seller."userId"
   WHERE seller.id = source_seller_id
   FOR UPDATE OF seller, seller_private;
  IF NOT FOUND OR source_current_seller."userId" IS DISTINCT FROM source_seller_user_id THEN
    source_seller_invalid_reason := 'Seller account could not be verified at payment completion.';
  ELSIF source_current_seller.user_banned THEN
    source_seller_invalid_reason := 'Seller account was suspended before payment completion.';
  ELSIF source_current_seller.user_deleted_at IS NOT NULL THEN
    source_seller_invalid_reason := 'Seller account was deleted before payment completion.';
  ELSIF NOT source_current_seller."chargesEnabled" THEN
    source_seller_invalid_reason := 'Seller Stripe account was disabled before payment completion.';
  ELSIF source_current_seller."stripeAccountId" IS NULL THEN
    source_seller_invalid_reason := 'Seller Stripe account was disconnected before payment completion.';
  ELSIF source_current_seller."stripeAccountId" IS DISTINCT FROM
        source_snapshot#>>'{seller,stripeAccountId}'
        OR source_current_seller."stripeAccountVersion" IS DISTINCT FROM
           source_snapshot#>>'{seller,stripeAccountVersion}' THEN
    source_seller_invalid_reason := 'Seller Stripe account changed before payment completion.';
  ELSIF source_current_seller."vacationMode" THEN
    source_seller_invalid_reason := 'Seller entered vacation mode before payment completion.';
  ELSIF NOT source_current_seller."acceptingNewOrders" THEN
    source_seller_invalid_reason := 'Seller stopped accepting new orders before payment completion.';
  END IF;

  -- Lock each retained Listing even if it became non-purchasable. Orders must
  -- describe checkout-time source while current state decides refund review.
  PERFORM listing.id
    FROM public."Listing" AS listing
   WHERE listing.id IN (
     SELECT item#>>'{listing,id}'
       FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item)
   )
   ORDER BY listing.id
   FOR UPDATE;

  source_paid_item_count := pg_catalog.jsonb_array_length(p_provider->'paidItems');
  SELECT pg_catalog.count(DISTINCT paid->>'sourceKey')
    INTO source_key_count
    FROM pg_catalog.jsonb_array_elements(p_provider->'paidItems') AS paid_items(paid);
  IF source_key_count <> source_paid_item_count THEN
    RAISE EXCEPTION 'Paid checkout provider item keys are invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT pg_catalog.count(DISTINCT CASE
           WHEN source_mode = 'cart' THEN retained.item->>'cartItemId'
           ELSE 'single:' || COALESCE(retained.item#>>'{listing,id}', '')
         END)
    INTO source_source_key_count
    FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item);
  IF source_source_key_count <> pg_catalog.jsonb_array_length(source_items) THEN
    RAISE EXCEPTION 'Paid checkout retained source keys are invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  FOR source_item IN
    SELECT retained.item
      FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item)
     ORDER BY CASE
       WHEN source_mode = 'cart' THEN retained.item->>'cartItemId'
       ELSE retained.item#>>'{listing,id}'
     END COLLATE "C"
  LOOP
    source_listing_id := source_item#>>'{listing,id}';
    source_quantity := NULL;
    IF source_item->>'quantity' ~ '^[1-9][0-9]{0,2}$' THEN
      source_quantity := (source_item->>'quantity')::integer;
    END IF;
    source_item_key := CASE
      WHEN source_mode = 'cart' THEN source_item->>'cartItemId'
      ELSE 'single:' || COALESCE(source_listing_id, '')
    END;
    IF source_listing_id IS NULL
       OR source_item#>>'{listing,sellerId}' IS DISTINCT FROM source_seller_id
       OR pg_catalog.lower(COALESCE(source_item#>>'{listing,currency}', 'usd'))
          IS DISTINCT FROM p_provider->>'currency'
       OR source_quantity IS NULL
       OR source_quantity > 200
       OR source_item_key IS NULL
       OR pg_catalog.char_length(source_item_key) NOT BETWEEN 1 AND 220
       OR pg_catalog.jsonb_typeof(source_item->'selectedVariantOptionIds') <> 'array'
       OR pg_catalog.jsonb_array_length(source_item->'selectedVariantOptionIds') > 3 THEN
      RAISE EXCEPTION 'Paid checkout retained item is invalid'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT paid
      INTO provider_item
      FROM pg_catalog.jsonb_array_elements(p_provider->'paidItems') AS paid_items(paid)
     WHERE paid->>'sourceKey' = source_item_key;
    IF NOT FOUND
       OR pg_catalog.jsonb_typeof(provider_item) <> 'object'
       OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(provider_item)) <> 5
       OR EXISTS (
         SELECT 1 FROM pg_catalog.jsonb_object_keys(provider_item) AS paid_key(key)
          WHERE key <> ALL (ARRAY[
            'sourceKey', 'listingId', 'variantKey', 'quantity', 'unitAmountCents'
          ])
       )
       OR provider_item->>'listingId' IS DISTINCT FROM source_listing_id
       OR provider_item->>'quantity' !~ '^[1-9][0-9]{0,2}$'
       OR (provider_item->>'quantity')::integer IS DISTINCT FROM source_quantity
       OR provider_item->>'unitAmountCents' !~ '^[1-9][0-9]{0,8}$' THEN
      RAISE EXCEPTION 'Paid checkout provider item is invalid'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(pg_catalog.sum((option_value->>'priceAdjustCents')::integer), 0),
           COALESCE(pg_catalog.string_agg(option_id, ',' ORDER BY option_id COLLATE "C"), ''),
           COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'groupName', group_value->>'name',
               'optionLabel', option_value->>'label',
               'priceAdjustCents', (option_value->>'priceAdjustCents')::integer
             ) ORDER BY selected.ordinality
           ), '[]'::jsonb),
           pg_catalog.count(*)
      INTO source_unit_price_cents, source_variant_key, source_selected_variants,
           source_selected_variant_count
      FROM pg_catalog.jsonb_array_elements_text(
             source_item->'selectedVariantOptionIds'
           ) WITH ORDINALITY AS selected(option_id, ordinality)
      JOIN LATERAL pg_catalog.jsonb_array_elements(
             source_item#>'{listing,variantGroups}'
           ) AS source_group(group_value) ON true
      JOIN LATERAL pg_catalog.jsonb_array_elements(
             group_value->'options'
           ) AS source_option(option_value)
        ON option_value->>'id' = selected.option_id;
    source_unit_price_cents :=
      (source_item#>>'{listing,priceCents}')::integer + source_unit_price_cents;
    IF source_selected_variant_count IS DISTINCT FROM
         pg_catalog.jsonb_array_length(source_item->'selectedVariantOptionIds')
       OR (
         SELECT pg_catalog.count(DISTINCT selected_id)
           FROM pg_catalog.jsonb_array_elements_text(
             source_item->'selectedVariantOptionIds'
           ) AS selected(selected_id)
       ) IS DISTINCT FROM source_selected_variant_count
       OR source_unit_price_cents NOT BETWEEN 1 AND 10000000
       OR (provider_item->>'unitAmountCents')::integer IS DISTINCT FROM source_unit_price_cents
       OR provider_item->>'variantKey' IS DISTINCT FROM source_variant_key THEN
      RAISE EXCEPTION 'Paid checkout provider price is invalid'
        USING ERRCODE = 'check_violation';
    END IF;
    source_items_subtotal := source_items_subtotal
      + source_unit_price_cents::bigint * source_quantity::bigint;
    IF source_items_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'Paid checkout item subtotal is invalid'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT listing.id, listing."sellerId", listing.status::text AS status,
           listing."listingType"::text AS listing_type, listing."stockQuantity", listing."isPrivate",
           listing."reservedForUserId"
      INTO source_current_listing
      FROM public."Listing" AS listing
     WHERE listing.id = source_listing_id;
    IF NOT FOUND THEN
      source_listing_invalid_reason := 'Listing could not be verified at payment completion.';
    ELSIF source_current_listing."sellerId" IS DISTINCT FROM source_seller_id THEN
      source_listing_invalid_reason := 'Listing seller changed before payment completion.';
    -- Inventory was already debited by this exact reservation. Completing a
    -- different paid reservation may have marked the last units SOLD_OUT;
    -- availability for new checkouts must not cancel these reserved units.
    -- Keep every other status/type/source/stock change fail-closed.
    ELSIF source_current_listing.status <> 'ACTIVE' AND NOT COALESCE(
      source_current_listing.status = 'SOLD_OUT'
      AND source_current_listing.listing_type = 'IN_STOCK'
      AND source_current_listing."stockQuantity" = 0
      AND source_item#>>'{listing,listingType}' = 'IN_STOCK'
      AND source_item#>>'{listing,status}' = 'ACTIVE',
      false
    ) THEN
      source_listing_invalid_reason := 'Listing was no longer active before payment completion.';
    ELSIF source_current_listing."isPrivate"
          AND source_current_listing."reservedForUserId" IS DISTINCT FROM
              source_buyer_id THEN
      source_listing_invalid_reason := 'Listing reservation changed before payment completion.';
    ELSE
      source_listing_invalid_reason := NULL;
    END IF;
    IF source_listing_invalid_reason IS NOT NULL
       AND NOT (source_listing_id = ANY(source_invalid_listing_ids)) THEN
      source_invalid_listing_ids := pg_catalog.array_append(
        source_invalid_listing_ids, source_listing_id
      );
      source_invalid_reason := pg_catalog.concat_ws(
        ' ', NULLIF(source_invalid_reason, ''), source_listing_invalid_reason
      );
    END IF;

    source_max_processing_days := GREATEST(
      source_max_processing_days,
      CASE source_item#>>'{listing,listingType}'
        WHEN 'IN_STOCK' THEN GREATEST(
          CASE WHEN source_mode = 'single' THEN 1 ELSE 3 END,
          COALESCE((source_item#>>'{listing,shipsWithinDays}')::integer, 1)
        )
        WHEN 'MADE_TO_ORDER' THEN GREATEST(
          3, COALESCE((source_item#>>'{listing,processingTimeMaxDays}')::integer, 0)
        )
        ELSE 0
      END
    );
  END LOOP;

  IF source_items_subtotal IS DISTINCT FROM (p_provider->>'itemsSubtotalCents')::bigint THEN
    RAISE EXCEPTION 'Paid checkout source subtotal is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  source_gift_wrapping := (p_provider->>'giftWrapping')::boolean;
  source_gift_wrapping_price := (p_provider->>'giftWrappingPriceCents')::integer;
  IF (NOT source_gift_wrapping AND source_gift_wrapping_price <> 0)
     OR (
       source_gift_wrapping
       AND (
         source_snapshot#>>'{seller,offersGiftWrapping}' <> 'true'
         OR source_snapshot#>>'{seller,giftWrappingPriceCents}' IS NULL
         OR (source_snapshot#>>'{seller,giftWrappingPriceCents}')::integer
            IS DISTINCT FROM source_gift_wrapping_price
       )
     ) THEN
    RAISE EXCEPTION 'Paid checkout gift-wrap source is invalid'
      USING ERRCODE = 'check_violation';
  END IF;

  source_invalid_reason := pg_catalog.concat_ws(
    ' ', source_buyer_invalid_reason, source_seller_invalid_reason,
    NULLIF(source_invalid_reason, '')
  );
  source_address_mismatch :=
    (COALESCE(p_provider->>'quotedToPostalCode', '') <> '' AND
      pg_catalog.upper(pg_catalog.split_part(p_provider->>'quotedToPostalCode', '-', 1)) <>
      pg_catalog.upper(pg_catalog.split_part(COALESCE(p_provider->>'shipToPostalCode', ''), '-', 1)))
    OR (COALESCE(p_provider->>'quotedToState', '') <> '' AND
      pg_catalog.upper(pg_catalog.btrim(p_provider->>'quotedToState')) <>
      pg_catalog.upper(pg_catalog.btrim(COALESCE(p_provider->>'shipToState', ''))))
    OR (COALESCE(p_provider->>'quotedToCity', '') <> '' AND
      pg_catalog.lower(pg_catalog.btrim(p_provider->>'quotedToCity')) <>
      pg_catalog.lower(pg_catalog.btrim(COALESCE(p_provider->>'shipToCity', ''))))
    OR (COALESCE(p_provider->>'quotedToCountry', '') <> '' AND
      pg_catalog.upper(pg_catalog.btrim(p_provider->>'quotedToCountry')) <>
      pg_catalog.upper(pg_catalog.btrim(COALESCE(p_provider->>'shipToCountry', ''))));
  source_amount_mismatch := p_provider->'quotedShippingAmountCents' <> 'null'::jsonb
    AND (
      p_provider->>'quotedShippingAmountCents' !~ '^[0-9]{1,10}$'
      OR (p_provider->>'quotedShippingAmountCents')::bigint <>
         (p_provider->>'shippingAmountCents')::bigint
    );
  source_review_needed := source_invalid_reason <> ''
    OR source_address_mismatch OR source_amount_mismatch;
  source_review_note := CASE
    WHEN source_invalid_reason <> ''
      THEN source_invalid_reason || ' Order was held for staff review.'
    WHEN source_address_mismatch OR source_amount_mismatch
      THEN 'Address and/or quoted amount changed at Checkout.'
    ELSE NULL
  END;

  source_fulfillment_method := CASE
    WHEN pg_catalog.lower(COALESCE(p_provider->>'shippingTitle', '')) LIKE '%pickup%'
      OR (
        p_provider->'shipToLine1' = 'null'::jsonb
        AND p_provider->'shipToCity' = 'null'::jsonb
        AND p_provider->'shipToPostalCode' = 'null'::jsonb
      ) THEN 'PICKUP'::public."FulfillmentMethod"
    ELSE 'SHIPPING'::public."FulfillmentMethod"
  END;
  IF (
       source_fulfillment_method = 'PICKUP'::public."FulfillmentMethod"
       AND source_snapshot#>>'{seller,allowLocalPickup}' <> 'true'
     )
     OR (
       source_fulfillment_method = 'SHIPPING'::public."FulfillmentMethod"
       AND (
         COALESCE(p_provider->>'shipToLine1', '') = ''
         OR COALESCE(p_provider->>'shipToCity', '') = ''
         OR COALESCE(p_provider->>'shipToPostalCode', '') = ''
         OR p_provider->>'shipToCountry' !~ '^[A-Z]{2}$'
       )
     ) THEN
    RAISE EXCEPTION 'Paid checkout fulfillment projection is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  source_processing_deadline := p_paid_at +
    pg_catalog.make_interval(days => source_max_processing_days);
  source_estimated_delivery := source_processing_deadline +
    pg_catalog.make_interval(days => (p_provider->>'estDays')::integer + 3);

  SELECT existing.*
    INTO source_existing_order
    FROM public."Order" AS existing
   WHERE existing."stripeSessionId" = p_session_id
   FOR UPDATE;
  IF FOUND THEN
    IF source_existing_order."paidAt" IS DISTINCT FROM p_paid_at
       OR source_existing_order.currency IS DISTINCT FROM p_provider->>'currency'
       OR source_existing_order."chargedTotalCents" IS DISTINCT FROM (p_provider->>'chargedTotalCents')::integer
       OR source_existing_order."itemsSubtotalCents" IS DISTINCT FROM (p_provider->>'itemsSubtotalCents')::integer
       OR source_existing_order."shippingAmountCents" IS DISTINCT FROM (p_provider->>'shippingAmountCents')::integer
       OR source_existing_order."taxAmountCents" IS DISTINCT FROM (p_provider->>'taxAmountCents')::integer
       OR source_existing_order."stripePaymentIntentId" IS DISTINCT FROM p_provider->>'stripePaymentIntentId'
       OR source_existing_order."stripeChargeId" IS DISTINCT FROM p_provider->>'stripeChargeId'
       OR source_existing_order."stripeTransferId" IS DISTINCT FROM p_provider->>'stripeTransferId' THEN
      RAISE EXCEPTION 'Paid checkout replay drifted'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN QUERY SELECT
      'replayed', source_existing_order.id, NULL::text, ARRAY[]::text[], false;
    RETURN;
  END IF;

  IF source_reservation.status <> 'SESSION_CREATED' THEN
    RAISE EXCEPTION 'Paid checkout completed reservation has no Order'
      USING ERRCODE = 'check_violation';
  END IF;

  source_order_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."Order" (
    id, "buyerId", "sellerProfileId", "createdAt", "paidAt",
    "stripeSessionId", currency, "chargedTotalCents", "itemsSubtotalCents",
    "shippingTitle", "shippingAmountCents", "taxAmountCents",
    "buyerEmail", "buyerName", "shipToLine1", "shipToLine2", "shipToCity",
    "shipToState", "shipToPostalCode", "shipToCountry",
    "stripePaymentIntentId", "stripeChargeId", "stripeApplicationFeeId",
    "stripeTransferId", "fulfillmentMethod", "fulfillmentStatus",
    "estimatedDeliveryDate", "processingDeadline", "shippingCarrier",
    "shippingService", "quotedShippingAmountCents", "reviewNeeded",
    "reviewNote", "quotedToLine1", "quotedToLine2", "quotedToCity",
    "quotedToState", "quotedToPostalCode", "quotedToCountry", "quotedToName",
    "quotedToPhone", "shippoShipmentId", "shippoRateObjectId", "giftNote",
    "giftWrapping", "giftWrappingPriceCents", "buyerDataPurgedAt"
  ) VALUES (
    source_order_id,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN source_buyer_id ELSE NULL END,
    source_seller_id, source_now, p_paid_at, p_session_id,
    p_provider->>'currency', (p_provider->>'chargedTotalCents')::integer,
    (p_provider->>'itemsSubtotalCents')::integer, p_provider->>'shippingTitle',
    (p_provider->>'shippingAmountCents')::integer,
    (p_provider->>'taxAmountCents')::integer,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'buyerEmail' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'buyerName' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToLine1' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToLine2' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToCity' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToState' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToPostalCode' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shipToCountry' ELSE NULL END,
    p_provider->>'stripePaymentIntentId', p_provider->>'stripeChargeId',
    p_provider->>'stripeApplicationFeeId', p_provider->>'stripeTransferId',
    source_fulfillment_method, 'PENDING'::public."FulfillmentStatus",
    source_estimated_delivery, source_processing_deadline,
    p_provider->>'shippingCarrier', p_provider->>'shippingService',
    CASE WHEN p_provider->'quotedShippingAmountCents' = 'null'::jsonb THEN NULL
      ELSE (p_provider->>'quotedShippingAmountCents')::integer END,
    source_review_needed, pg_catalog.left(source_review_note, 10000),
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToLine1' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToLine2' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToCity' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToState' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToPostalCode' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToCountry' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToName' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'quotedToPhone' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shippoShipmentId' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'shippoRateObjectId' ELSE NULL END,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN p_provider->>'giftNote' ELSE NULL END,
    source_gift_wrapping, source_gift_wrapping_price,
    CASE WHEN source_buyer_invalid_reason IS NULL THEN NULL ELSE source_now END
  );

  FOR source_item IN
    SELECT retained.item
      FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item)
     ORDER BY CASE
       WHEN source_mode = 'cart' THEN retained.item->>'cartItemId'
       ELSE retained.item#>>'{listing,id}'
     END COLLATE "C"
  LOOP
    source_listing_id := source_item#>>'{listing,id}';
    source_item_key := CASE WHEN source_mode = 'cart'
      THEN source_item->>'cartItemId' ELSE 'single:' || source_listing_id END;
    SELECT paid INTO STRICT provider_item
      FROM pg_catalog.jsonb_array_elements(p_provider->'paidItems') AS paid_items(paid)
     WHERE paid->>'sourceKey' = source_item_key;

    SELECT COALESCE(pg_catalog.sum((option_value->>'priceAdjustCents')::integer), 0),
           COALESCE(pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'groupName', group_value->>'name',
               'optionLabel', option_value->>'label',
               'priceAdjustCents', (option_value->>'priceAdjustCents')::integer
             ) ORDER BY selected.ordinality
           ), '[]'::jsonb)
      INTO source_unit_price_cents, source_selected_variants
      FROM pg_catalog.jsonb_array_elements_text(
             source_item->'selectedVariantOptionIds'
           ) WITH ORDINALITY AS selected(option_id, ordinality)
      JOIN LATERAL pg_catalog.jsonb_array_elements(
             source_item#>'{listing,variantGroups}'
           ) AS source_group(group_value) ON true
      JOIN LATERAL pg_catalog.jsonb_array_elements(group_value->'options')
           AS source_option(option_value)
        ON option_value->>'id' = selected.option_id;
    source_unit_price_cents :=
      (source_item#>>'{listing,priceCents}')::integer + source_unit_price_cents;

    source_weight := COALESCE(
      (source_item#>>'{listing,packagedWeightGrams}')::double precision,
      (source_snapshot#>>'{seller,defaultPkgWeightGrams}')::double precision
    );
    source_length := COALESCE(
      (source_item#>>'{listing,packagedLengthCm}')::double precision,
      (source_snapshot#>>'{seller,defaultPkgLengthCm}')::double precision
    );
    source_width := COALESCE(
      (source_item#>>'{listing,packagedWidthCm}')::double precision,
      (source_snapshot#>>'{seller,defaultPkgWidthCm}')::double precision
    );
    source_height := COALESCE(
      (source_item#>>'{listing,packagedHeightCm}')::double precision,
      (source_snapshot#>>'{seller,defaultPkgHeightCm}')::double precision
    );
    source_package_complete := source_weight > 0 AND source_weight <= 500000
      AND source_length > 0 AND source_length <= 1000
      AND source_width > 0 AND source_width <= 1000
      AND source_height > 0 AND source_height <= 1000;

    source_listing_snapshot := pg_catalog.jsonb_build_object(
      'title', source_item#>>'{listing,title}',
      'description', source_item#>>'{listing,description}',
      'priceCents', source_unit_price_cents,
      'imageUrls', source_item#>'{listing,imageUrls}',
      'category', source_item#>'{listing,category}',
      'tags', source_item#>'{listing,tags}',
      'sellerName', source_snapshot#>>'{seller,displayName}',
      'capturedAt', pg_catalog.to_char(p_paid_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'listingType', source_item#>>'{listing,listingType}',
      'processingTimeMinDays', source_item#>'{listing,processingTimeMinDays}',
      'processingTimeMaxDays', source_item#>'{listing,processingTimeMaxDays}',
      'shipsWithinDays', source_item#>'{listing,shipsWithinDays}',
      'shippingWeightGrams', CASE WHEN source_package_complete THEN source_weight ELSE NULL END,
      'shippingLengthCm', CASE WHEN source_package_complete THEN source_length ELSE NULL END,
      'shippingWidthCm', CASE WHEN source_package_complete THEN source_width ELSE NULL END,
      'shippingHeightCm', CASE WHEN source_package_complete THEN source_height ELSE NULL END,
      'shippingPackageComplete', source_package_complete
    );

    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "sellerProfileId", quantity,
      "priceCents", "listingSnapshot", "selectedVariants", "createdAt"
    ) VALUES (
      pg_catalog.gen_random_uuid()::text, source_order_id, source_listing_id,
      source_seller_id, (provider_item->>'quantity')::integer,
      source_unit_price_cents, source_listing_snapshot,
      CASE WHEN source_selected_variants = '[]'::jsonb THEN NULL
        ELSE source_selected_variants END,
      source_now
    );

    UPDATE public."Listing" AS listing
       SET status = 'SOLD_OUT'
     WHERE listing.id = source_listing_id
       AND listing."listingType" = 'IN_STOCK'
       AND listing."stockQuantity" <= 0
       AND listing.status = 'ACTIVE';
    source_listing_visibility_changed := source_listing_visibility_changed OR FOUND;

    UPDATE public."Listing" AS listing
       SET status = 'SOLD'
     WHERE listing.id = source_listing_id
       AND listing."listingType" = 'MADE_TO_ORDER'
       AND listing."isPrivate"
       AND listing."reservedForUserId" = source_buyer_id
       AND listing.status = 'ACTIVE'
       AND source_invalid_reason = '';
    source_listing_visibility_changed := source_listing_visibility_changed OR FOUND;
  END LOOP;

  INSERT INTO public."SystemAuditLog" (
    id, "actorType", "actorId", action, "targetType", "targetId",
    reason, metadata, "createdAt"
  ) VALUES (
    'stripe-checkout-order:' || pg_catalog.gen_random_uuid()::text,
    'webhook', p_event_id, 'STRIPE_CHECKOUT_ORDER_CREATED',
    'ORDER', source_order_id, pg_catalog.left(NULLIF(source_invalid_reason, ''), 1000),
    pg_catalog.jsonb_build_object(
      'stripeEventType', source_event.type,
      'stripeSessionId', p_session_id,
      'stripePaymentIntentId', p_provider->>'stripePaymentIntentId',
      'stripeChargeId', p_provider->>'stripeChargeId',
      'checkoutMode', source_mode,
      'reviewNeeded', source_review_needed,
      'invalidReason', NULLIF(source_invalid_reason, ''),
      'itemCount', pg_catalog.jsonb_array_length(source_items),
      'currency', p_provider->>'currency',
      'chargedTotalCents', (p_provider->>'chargedTotalCents')::integer,
      'itemsSubtotalCents', (p_provider->>'itemsSubtotalCents')::integer,
      'shippingAmountCents', (p_provider->>'shippingAmountCents')::integer,
      'taxAmountCents', (p_provider->>'taxAmountCents')::integer
    ), source_now
  );

  SELECT public.grainline_checkout_reservation_complete(
    p_event_id, p_claim_generation, p_reservation_id, p_session_id
  ) INTO STRICT source_completion_result;
  IF source_completion_result <> 'completed' THEN
    RAISE EXCEPTION 'Paid checkout reservation completion failed'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF source_mode = 'cart' THEN
    DELETE FROM public."CartItem" AS cart_item
     WHERE cart_item.id IN (
       SELECT retained.item->>'cartItemId'
         FROM pg_catalog.jsonb_array_elements(source_items) AS retained(item)
     );
  END IF;

  RETURN QUERY SELECT
    'created', source_order_id, NULLIF(source_invalid_reason, ''),
    CASE WHEN source_seller_invalid_reason IS NULL
      THEN ARRAY[]::text[] ELSE ARRAY[source_seller_user_id]::text[] END,
    source_listing_visibility_changed;
END;
$grainline_stripe_checkout_order_create$;

COMMIT;
