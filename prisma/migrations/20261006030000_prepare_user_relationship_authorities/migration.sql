CREATE OR REPLACE FUNCTION public.grainline_user_relationship_target_state(
  p_actor_id text,
  p_target_id text
)
RETURNS TABLE (
  id text,
  name text,
  banned boolean,
  "deletedAt" timestamp(3)
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_relationship_target_state$
BEGIN
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_target_id IS NULL
     OR p_target_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'User relationship target input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT target.id,
         target.name::text,
         target.banned,
         target."deletedAt"
    FROM public."User" AS target
   WHERE target.id = p_target_id
     AND EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = p_actor_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     );
END
$grainline_user_relationship_target_state$;

CREATE OR REPLACE FUNCTION public.grainline_user_conversation_participants(
  p_actor_id text,
  p_conversation_id text
)
RETURNS TABLE (
  id text,
  name text,
  "imageUrl" text,
  banned boolean,
  "deletedAt" timestamp(3)
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_conversation_participants$
DECLARE
  target_conversation record;
BEGIN
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_conversation_id IS NULL
     OR p_conversation_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'User conversation participant input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config('app.user_id', p_actor_id, true) <> p_actor_id THEN
    RAISE EXCEPTION 'User conversation actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  SELECT conversation."userAId", conversation."userBId"
    INTO target_conversation
    FROM public."Conversation" AS conversation
   WHERE conversation.id = p_conversation_id
     AND (
       p_actor_id IN (conversation."userAId", conversation."userBId")
       OR (
         EXISTS (
           SELECT 1
             FROM public."User" AS staff_user
            WHERE staff_user.id = p_actor_id
              AND staff_user.role IN (
                'EMPLOYEE'::public."Role",
                'ADMIN'::public."Role"
              )
              AND staff_user.banned = false
              AND staff_user."deletedAt" IS NULL
         )
         AND EXISTS (
           SELECT 1
             FROM public."UserReport" AS report
            WHERE report."targetType" = 'MESSAGE_THREAD'
              AND report."targetId" = p_conversation_id
              AND report.resolved = false
         )
       )
     );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User conversation participants are unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT account_user.id,
         account_user.name::text,
         account_user."imageUrl"::text,
         account_user.banned,
         account_user."deletedAt"
    FROM public."User" AS account_user
   WHERE account_user.id IN (
     target_conversation."userAId",
     target_conversation."userBId"
   )
   ORDER BY account_user.id;
END
$grainline_user_conversation_participants$;

CREATE OR REPLACE FUNCTION public.grainline_user_custom_order_seller_state(
  p_buyer_id text,
  p_seller_user_id text
)
RETURNS TABLE (
  "userId" text,
  banned boolean,
  "deletedAt" timestamp(3),
  "sellerProfileId" text,
  "acceptsCustomOrders" boolean,
  "acceptingNewOrders" boolean,
  "stripeAccountId" text,
  "stripeAccountVersion" text,
  "chargesEnabled" boolean,
  "vacationMode" boolean,
  "displayName" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_custom_order_seller_state$
BEGIN
  IF p_buyer_id IS NULL
     OR p_buyer_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_user_id IS NULL
     OR p_seller_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_buyer_id = p_seller_user_id THEN
    RAISE EXCEPTION 'Custom-order seller input is invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT seller_user.id,
         seller_user.banned,
         seller_user."deletedAt",
         seller.id,
         seller."acceptsCustomOrders",
         seller."acceptingNewOrders",
         seller."stripeAccountId"::text,
         seller."stripeAccountVersion"::text,
         seller."chargesEnabled",
         seller."vacationMode",
         seller."displayName"::text
    FROM public."User" AS seller_user
    LEFT JOIN public."SellerProfile" AS seller
      ON seller."userId" = seller_user.id
   WHERE seller_user.id = p_seller_user_id
     AND EXISTS (
       SELECT 1
         FROM public."User" AS buyer
        WHERE buyer.id = p_buyer_id
          AND buyer.banned = false
          AND buyer."deletedAt" IS NULL
     );
END
$grainline_user_custom_order_seller_state$;

CREATE OR REPLACE FUNCTION public.grainline_user_owner_notification_preferences(
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_user_owner_notification_preferences$
DECLARE
  preferences jsonb;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Owner notification preference input is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_user."notificationPreferences"
    INTO preferences
    FROM public."User" AS account_user
   WHERE account_user.id = p_user_id
     AND account_user.banned = false
     AND account_user."deletedAt" IS NULL;
  RETURN preferences;
END
$grainline_user_owner_notification_preferences$;

REVOKE ALL ON FUNCTION public.grainline_user_relationship_target_state(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_relationship_target_state(text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_conversation_participants(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_conversation_participants(text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_custom_order_seller_state(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_custom_order_seller_state(text, text)
  TO grainline_app_runtime;

REVOKE ALL ON FUNCTION public.grainline_user_owner_notification_preferences(text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_user_owner_notification_preferences(text)
  TO grainline_app_runtime;
