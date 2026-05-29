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
      'EMAIL_ORDER_SHIPPED',
      'EMAIL_ORDER_DELIVERED',
      'EMAIL_CASE_OPENED',
      'EMAIL_CASE_MESSAGE',
      'EMAIL_CASE_RESOLVED',
      'EMAIL_REFUND_ISSUED',
      'EMAIL_CUSTOM_ORDER',
      'EMAIL_CUSTOM_ORDER_LINK',
      'EMAIL_VERIFICATION_APPROVED',
      'EMAIL_VERIFICATION_REJECTED',
      'EMAIL_BACK_IN_STOCK',
      'EMAIL_NEW_REVIEW',
      'EMAIL_LOW_STOCK',
      'EMAIL_NEW_FAVORITE',
      'EMAIL_NEW_BLOG_COMMENT',
      'EMAIL_BLOG_COMMENT_REPLY',
      'EMAIL_NEW_FOLLOWER',
      'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
      'EMAIL_FOLLOWED_MAKER_NEW_BLOG',
      'EMAIL_SELLER_BROADCAST',
      'EMAIL_COMMISSION_INTEREST',
      'EMAIL_LISTING_APPROVED',
      'EMAIL_LISTING_REJECTED',
      'EMAIL_ACCOUNT_WARNING',
      'EMAIL_LISTING_FLAGGED_BY_USER',
      'EMAIL_PAYMENT_DISPUTE',
      'EMAIL_PAYOUT_FAILED'
    )
    OR jsonb_typeof(pref.value) <> 'boolean'
  );
END;
$$;

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
      'EMAIL_ORDER_SHIPPED',
      'EMAIL_ORDER_DELIVERED',
      'EMAIL_CASE_OPENED',
      'EMAIL_CASE_MESSAGE',
      'EMAIL_CASE_RESOLVED',
      'EMAIL_REFUND_ISSUED',
      'EMAIL_CUSTOM_ORDER',
      'EMAIL_CUSTOM_ORDER_LINK',
      'EMAIL_VERIFICATION_APPROVED',
      'EMAIL_VERIFICATION_REJECTED',
      'EMAIL_BACK_IN_STOCK',
      'EMAIL_NEW_REVIEW',
      'EMAIL_LOW_STOCK',
      'EMAIL_NEW_FAVORITE',
      'EMAIL_NEW_BLOG_COMMENT',
      'EMAIL_BLOG_COMMENT_REPLY',
      'EMAIL_NEW_FOLLOWER',
      'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
      'EMAIL_FOLLOWED_MAKER_NEW_BLOG',
      'EMAIL_SELLER_BROADCAST',
      'EMAIL_COMMISSION_INTEREST',
      'EMAIL_LISTING_APPROVED',
      'EMAIL_LISTING_REJECTED',
      'EMAIL_ACCOUNT_WARNING',
      'EMAIL_LISTING_FLAGGED_BY_USER',
      'EMAIL_PAYMENT_DISPUTE',
      'EMAIL_PAYOUT_FAILED'
    )
    AND jsonb_typeof(pref.value) = 'boolean'
  ), '{}'::jsonb)
  ELSE '{}'::jsonb
END
WHERE NOT "grainline_notification_preferences_valid"("notificationPreferences");

ALTER TABLE "User"
  ADD CONSTRAINT "User_notificationPreferences_shape_chk"
  CHECK ("grainline_notification_preferences_valid"("notificationPreferences")) NOT VALID,
  ADD CONSTRAINT "User_notificationPreferences_size_chk"
  CHECK (octet_length("notificationPreferences"::text) <= 8192) NOT VALID;

ALTER TABLE "User" VALIDATE CONSTRAINT "User_notificationPreferences_shape_chk";
ALTER TABLE "User" VALIDATE CONSTRAINT "User_notificationPreferences_size_chk";

ALTER TABLE "AdminAuditLog"
  ADD CONSTRAINT "AdminAuditLog_metadata_size_chk"
  CHECK (octet_length("metadata"::text) <= 1000000) NOT VALID;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_listingSnapshot_size_chk"
  CHECK ("listingSnapshot" IS NULL OR octet_length("listingSnapshot"::text) <= 128000) NOT VALID,
  ADD CONSTRAINT "OrderItem_selectedVariants_size_chk"
  CHECK ("selectedVariants" IS NULL OR octet_length("selectedVariants"::text) <= 16000) NOT VALID;

ALTER TABLE "OrderShippingRateQuote"
  ADD CONSTRAINT "OrderShippingRateQuote_rates_size_chk"
  CHECK (octet_length("rates"::text) <= 64000) NOT VALID;

ALTER TABLE "OrderPaymentEvent"
  ADD CONSTRAINT "OrderPaymentEvent_metadata_size_chk"
  CHECK ("metadata" IS NULL OR octet_length("metadata"::text) <= 64000) NOT VALID;

ALTER TABLE "EmailSuppression"
  ADD CONSTRAINT "EmailSuppression_details_size_chk"
  CHECK (octet_length("details"::text) <= 16000) NOT VALID;

ALTER TABLE "CronRun"
  ADD CONSTRAINT "CronRun_result_size_chk"
  CHECK ("result" IS NULL OR octet_length("result"::text) <= 64000) NOT VALID;
