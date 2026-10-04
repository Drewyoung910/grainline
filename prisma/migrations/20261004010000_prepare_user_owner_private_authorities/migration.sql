CREATE OR REPLACE FUNCTION public.grainline_user_owner_shipping_address_update(
  p_user_id text,
  p_name text,
  p_line1 text,
  p_line2 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_phone text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_owner_shipping_address_update$
DECLARE
  changed_at timestamp(3);
  updated_rows integer := 0;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_name IS NULL
     OR pg_catalog.char_length(p_name) NOT BETWEEN 1 AND 100
     OR p_line1 IS NULL
     OR pg_catalog.char_length(p_line1) NOT BETWEEN 1 AND 200
     OR (p_line2 IS NOT NULL AND pg_catalog.char_length(p_line2) > 200)
     OR p_city IS NULL
     OR pg_catalog.char_length(p_city) NOT BETWEEN 1 AND 100
     OR p_state IS NULL
     OR p_state <> ALL (ARRAY[
       'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
       'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
       'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
       'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
       'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
     ]::text[])
     OR p_postal_code IS NULL
     OR p_postal_code !~ '^[0-9]{5}(-[0-9]{4})?$'
     OR (p_phone IS NOT NULL AND pg_catalog.char_length(p_phone) > 20) THEN
    RAISE EXCEPTION 'Owner shipping address input is invalid'
      USING ERRCODE = '22023';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."User" AS account_user
     SET "shippingName" = p_name,
         "shippingLine1" = p_line1,
         "shippingLine2" = p_line2,
         "shippingCity" = p_city,
         "shippingState" = p_state,
         "shippingPostalCode" = p_postal_code,
         "shippingPhone" = p_phone,
         "updatedAt" = changed_at
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows = 1;
END
$grainline_user_owner_shipping_address_update$;

CREATE OR REPLACE FUNCTION public.grainline_user_owner_legal_acceptance(
  p_user_id text,
  p_terms_version text
)
RETURNS TABLE (
  "termsAcceptedAt" timestamp(3),
  "termsVersion" text,
  "ageAttestedAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_owner_legal_acceptance$
DECLARE
  changed_at timestamp(3);
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_terms_version IS DISTINCT FROM '2026-06-14' THEN
    RAISE EXCEPTION 'Owner legal acceptance input is invalid'
      USING ERRCODE = '22023';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  RETURN QUERY
  UPDATE public."User" AS account_user
     SET "termsAcceptedAt" = CASE
           WHEN account_user."termsAcceptedAt" IS NOT NULL
            AND account_user."ageAttestedAt" IS NOT NULL
            AND account_user."termsVersion" = p_terms_version
           THEN account_user."termsAcceptedAt"
           ELSE changed_at
         END,
         "ageAttestedAt" = CASE
           WHEN account_user."termsAcceptedAt" IS NOT NULL
            AND account_user."ageAttestedAt" IS NOT NULL
            AND account_user."termsVersion" = p_terms_version
           THEN account_user."ageAttestedAt"
           ELSE changed_at
         END,
         "termsVersion" = p_terms_version,
         "updatedAt" = changed_at
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL
  RETURNING
    account_user."termsAcceptedAt",
    account_user."termsVersion"::text,
    account_user."ageAttestedAt";
END
$grainline_user_owner_legal_acceptance$;

CREATE OR REPLACE FUNCTION public.grainline_user_owner_notification_preference_update(
  p_user_id text,
  p_preference_key text,
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_owner_notification_preference_update$
DECLARE
  changed_at timestamp(3);
  updated_rows integer := 0;
  email_preference boolean;
BEGIN
  email_preference := p_preference_key = ANY (ARRAY[
    'EMAIL_NEW_MESSAGE', 'EMAIL_NEW_ORDER',
    'EMAIL_CASE_OPENED', 'EMAIL_CASE_MESSAGE', 'EMAIL_CASE_RESOLVED',
    'EMAIL_REFUND_ISSUED', 'EMAIL_CUSTOM_ORDER',
    'EMAIL_VERIFICATION_APPROVED', 'EMAIL_VERIFICATION_REJECTED',
    'EMAIL_BACK_IN_STOCK', 'EMAIL_NEW_REVIEW',
    'EMAIL_FOLLOWED_MAKER_NEW_LISTING', 'EMAIL_SELLER_BROADCAST'
  ]::text[]);

  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_enabled IS NULL
     OR p_preference_key IS NULL
     OR p_preference_key <> ALL (ARRAY[
       'NEW_MESSAGE', 'NEW_ORDER', 'ORDER_SHIPPED', 'ORDER_DELIVERED',
       'CASE_OPENED', 'CASE_MESSAGE', 'CASE_RESOLVED', 'REFUND_ISSUED',
       'CUSTOM_ORDER_REQUEST', 'CUSTOM_ORDER_LINK',
       'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED',
       'BACK_IN_STOCK', 'NEW_REVIEW', 'LOW_STOCK', 'NEW_FAVORITE',
       'NEW_BLOG_COMMENT', 'BLOG_COMMENT_REPLY', 'NEW_FOLLOWER',
       'FOLLOWED_MAKER_NEW_LISTING', 'FOLLOWED_MAKER_NEW_BLOG',
       'SELLER_BROADCAST', 'COMMISSION_INTEREST', 'LISTING_APPROVED',
       'LISTING_REJECTED', 'ACCOUNT_WARNING', 'LISTING_FLAGGED_BY_USER',
       'PAYMENT_DISPUTE', 'PAYOUT_FAILED',
       'EMAIL_NEW_MESSAGE', 'EMAIL_NEW_ORDER', 'EMAIL_CASE_OPENED',
       'EMAIL_CASE_MESSAGE', 'EMAIL_CASE_RESOLVED', 'EMAIL_REFUND_ISSUED',
       'EMAIL_CUSTOM_ORDER', 'EMAIL_VERIFICATION_APPROVED',
       'EMAIL_VERIFICATION_REJECTED', 'EMAIL_BACK_IN_STOCK',
       'EMAIL_NEW_REVIEW', 'EMAIL_FOLLOWED_MAKER_NEW_LISTING',
       'EMAIL_SELLER_BROADCAST'
     ]::text[]) THEN
    RAISE EXCEPTION 'Owner notification preference input is invalid'
      USING ERRCODE = '22023';
  END IF;

  changed_at := pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  UPDATE public."User" AS account_user
     SET "notificationPreferences" = pg_catalog.jsonb_set(
           COALESCE(account_user."notificationPreferences", '{}'::jsonb),
           ARRAY[p_preference_key]::text[],
           pg_catalog.to_jsonb(p_enabled),
           true
         ),
         "emailPreferenceOptInAt" = CASE
           WHEN p_enabled AND email_preference THEN changed_at
           ELSE account_user."emailPreferenceOptInAt"
         END,
         "updatedAt" = changed_at
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL;

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows = 1;
END
$grainline_user_owner_notification_preference_update$;

REVOKE ALL ON FUNCTION
  public.grainline_user_owner_shipping_address_update(
    text, text, text, text, text, text, text, text
  )
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_owner_shipping_address_update(
    text, text, text, text, text, text, text, text
  )
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_owner_legal_acceptance(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_owner_legal_acceptance(text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION
  public.grainline_user_owner_notification_preference_update(text, text, boolean)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_user_owner_notification_preference_update(text, text, boolean)
  TO grainline_app_runtime;
