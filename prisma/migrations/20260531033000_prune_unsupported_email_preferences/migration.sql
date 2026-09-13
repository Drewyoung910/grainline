-- Keep notification preference storage aligned with sender-backed email keys.
-- Unsupported legacy EMAIL_* keys are pruned before the validator is narrowed.

UPDATE "User"
SET "notificationPreferences" = CASE
  WHEN jsonb_typeof("notificationPreferences") = 'object' THEN COALESCE((
    SELECT jsonb_object_agg(pref.key, pref.value)
    FROM jsonb_each("notificationPreferences") AS pref(key, value)
    WHERE pref.key IN (
      'NEW_MESSAGE',
      'NEW_ORDER',
      'ORDER_SHIPPED',
      'ORDER_DELIVERED',
      'CASE_OPENED',
      'CASE_MESSAGE',
      'CASE_RESOLVED',
      'REFUND_ISSUED',
      'CUSTOM_ORDER_REQUEST',
      'CUSTOM_ORDER_LINK',
      'VERIFICATION_APPROVED',
      'VERIFICATION_REJECTED',
      'BACK_IN_STOCK',
      'NEW_REVIEW',
      'LOW_STOCK',
      'NEW_FAVORITE',
      'NEW_BLOG_COMMENT',
      'BLOG_COMMENT_REPLY',
      'NEW_FOLLOWER',
      'FOLLOWED_MAKER_NEW_LISTING',
      'FOLLOWED_MAKER_NEW_BLOG',
      'SELLER_BROADCAST',
      'COMMISSION_INTEREST',
      'LISTING_APPROVED',
      'LISTING_REJECTED',
      'ACCOUNT_WARNING',
      'LISTING_FLAGGED_BY_USER',
      'PAYMENT_DISPUTE',
      'PAYOUT_FAILED',
      'EMAIL_NEW_MESSAGE',
      'EMAIL_NEW_ORDER',
      'EMAIL_CASE_OPENED',
      'EMAIL_CASE_MESSAGE',
      'EMAIL_CASE_RESOLVED',
      'EMAIL_REFUND_ISSUED',
      'EMAIL_CUSTOM_ORDER',
      'EMAIL_VERIFICATION_APPROVED',
      'EMAIL_VERIFICATION_REJECTED',
      'EMAIL_BACK_IN_STOCK',
      'EMAIL_NEW_REVIEW',
      'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
      'EMAIL_SELLER_BROADCAST'
    )
    AND jsonb_typeof(pref.value) = 'boolean'
  ), '{}'::jsonb)
  ELSE '{}'::jsonb
END
WHERE NOT "grainline_notification_preferences_valid"("notificationPreferences")
  OR EXISTS (
    SELECT 1
    FROM jsonb_each(
      CASE
        WHEN jsonb_typeof("notificationPreferences") = 'object' THEN "notificationPreferences"
        ELSE '{}'::jsonb
      END
    ) AS pref(key, value)
    WHERE pref.key LIKE 'EMAIL_%'
      AND pref.key NOT IN (
        'EMAIL_NEW_MESSAGE',
        'EMAIL_NEW_ORDER',
        'EMAIL_CASE_OPENED',
        'EMAIL_CASE_MESSAGE',
        'EMAIL_CASE_RESOLVED',
        'EMAIL_REFUND_ISSUED',
        'EMAIL_CUSTOM_ORDER',
        'EMAIL_VERIFICATION_APPROVED',
        'EMAIL_VERIFICATION_REJECTED',
        'EMAIL_BACK_IN_STOCK',
        'EMAIL_NEW_REVIEW',
        'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
        'EMAIL_SELLER_BROADCAST'
      )
  );

CREATE OR REPLACE FUNCTION "grainline_notification_preferences_valid"(preferences JSONB)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF preferences IS NULL OR jsonb_typeof(preferences) <> 'object' THEN
    RETURN false;
  END IF;

  RETURN NOT EXISTS (
    SELECT 1
    FROM jsonb_each(preferences) AS pref(key, value)
    WHERE pref.key NOT IN (
      'NEW_MESSAGE',
      'NEW_ORDER',
      'ORDER_SHIPPED',
      'ORDER_DELIVERED',
      'CASE_OPENED',
      'CASE_MESSAGE',
      'CASE_RESOLVED',
      'REFUND_ISSUED',
      'CUSTOM_ORDER_REQUEST',
      'CUSTOM_ORDER_LINK',
      'VERIFICATION_APPROVED',
      'VERIFICATION_REJECTED',
      'BACK_IN_STOCK',
      'NEW_REVIEW',
      'LOW_STOCK',
      'NEW_FAVORITE',
      'NEW_BLOG_COMMENT',
      'BLOG_COMMENT_REPLY',
      'NEW_FOLLOWER',
      'FOLLOWED_MAKER_NEW_LISTING',
      'FOLLOWED_MAKER_NEW_BLOG',
      'SELLER_BROADCAST',
      'COMMISSION_INTEREST',
      'LISTING_APPROVED',
      'LISTING_REJECTED',
      'ACCOUNT_WARNING',
      'LISTING_FLAGGED_BY_USER',
      'PAYMENT_DISPUTE',
      'PAYOUT_FAILED',
      'EMAIL_NEW_MESSAGE',
      'EMAIL_NEW_ORDER',
      'EMAIL_CASE_OPENED',
      'EMAIL_CASE_MESSAGE',
      'EMAIL_CASE_RESOLVED',
      'EMAIL_REFUND_ISSUED',
      'EMAIL_CUSTOM_ORDER',
      'EMAIL_VERIFICATION_APPROVED',
      'EMAIL_VERIFICATION_REJECTED',
      'EMAIL_BACK_IN_STOCK',
      'EMAIL_NEW_REVIEW',
      'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
      'EMAIL_SELLER_BROADCAST'
    )
    OR jsonb_typeof(pref.value) <> 'boolean'
  );
END;
$$;

ALTER TABLE "User" DROP CONSTRAINT "User_notificationPreferences_shape_chk";
ALTER TABLE "User"
  ADD CONSTRAINT "User_notificationPreferences_shape_chk"
  CHECK ("grainline_notification_preferences_valid"("notificationPreferences")) NOT VALID;
ALTER TABLE "User" VALIDATE CONSTRAINT "User_notificationPreferences_shape_chk";
