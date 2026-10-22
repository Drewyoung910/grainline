-- Move the PIN-gated admin feature/unfeature transition behind one atomic,
-- isolated-staff database authority. No RLS or direct table grant changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_seller_staff_feature_transition(
  p_actor_id text,
  p_seller_profile_id text,
  p_operation text
)
RETURNS TABLE (
  applied boolean,
  "auditId" text,
  "sellerProfileId" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_seller_staff_feature_transition$
DECLARE
  source_now timestamp(3) without time zone :=
    (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  source_seller public."SellerProfile"%ROWTYPE;
  audit_id text;
BEGIN
  IF SESSION_USER <> 'grainline_staff_read_runtime' THEN
    RAISE EXCEPTION 'Seller feature transition requires the isolated staff session'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
     OR p_actor_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_seller_profile_id IS NULL
     OR p_seller_profile_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR p_operation IS NULL
     OR p_operation NOT IN ('FEATURE', 'UNFEATURE') THEN
    RAISE EXCEPTION 'Seller feature transition input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = p_actor_id
     AND actor.role::text = 'ADMIN'
     AND actor.banned = false
     AND actor."deletedAt" IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller feature transition actor is not authorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT seller.*
    INTO source_seller
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text, NULL::text;
    RETURN;
  END IF;

  IF p_operation = 'FEATURE' THEN
    IF source_seller."userId" = p_actor_id
       OR NOT source_seller."ownerAccountActive"
       OR NOT source_seller."chargesEnabled"
       OR NOT source_seller."stripeAccountSupported"
       OR source_seller."vacationMode"
       OR source_seller."guildLevel" NOT IN (
         'GUILD_MEMBER'::public."GuildLevel",
         'GUILD_MASTER'::public."GuildLevel"
       )
       OR (
         source_seller."featuredUntil" IS NOT NULL
         AND source_seller."featuredUntil" > source_now
       ) THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id;
      RETURN;
    END IF;

    UPDATE public."SellerProfile"
       SET "featuredUntil" = source_now + INTERVAL '7 days',
           "updatedAt" = source_now
     WHERE id = source_seller.id;
  ELSE
    IF source_seller."featuredUntil" IS NULL THEN
      RETURN QUERY SELECT false, NULL::text, source_seller.id;
      RETURN;
    END IF;

    UPDATE public."SellerProfile"
       SET "featuredUntil" = NULL,
           "updatedAt" = source_now
     WHERE id = source_seller.id;
  END IF;

  audit_id := pg_catalog.gen_random_uuid()::text;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", metadata,
    undone, "createdAt"
  ) VALUES (
    audit_id,
    p_actor_id,
    CASE p_operation WHEN 'FEATURE' THEN 'FEATURE_MAKER' ELSE 'UNFEATURE_MAKER' END,
    'SELLER_PROFILE',
    source_seller.id,
    '{}'::jsonb,
    false,
    source_now
  );

  RETURN QUERY SELECT true, audit_id, source_seller.id;
END
$grainline_seller_staff_feature_transition$;

REVOKE ALL ON FUNCTION public.grainline_seller_staff_feature_transition(text,text,text)
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_seller_staff_feature_transition(text,text,text)
  TO grainline_staff_read_runtime;

COMMIT;
