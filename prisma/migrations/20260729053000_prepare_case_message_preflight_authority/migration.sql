-- Compatible recipient-scoped preflight for Case replies and private evidence
-- uploads. The final grainline_case_reply operation still re-locks and
-- revalidates every write. Direct Case-family grants and RLS posture remain
-- unchanged so old and new application deployments can coexist.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_message_preflight(
  p_actor_user_id text,
  p_case_id text
)
RETURNS TABLE (
  "caseId" text,
  "orderId" text,
  "buyerUserId" text,
  "sellerUserId" text,
  status text,
  "authorKind" text,
  "actsAsStaff" boolean,
  "canCreateMessage" boolean,
  "recipientUnavailableReason" text
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_message_preflight$
DECLARE
  actor_role public."Role";
  actor_banned boolean;
  actor_deleted_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_case_id IS NULL
     OR pg_catalog.btrim(p_case_id) = ''
     OR pg_catalog.char_length(p_case_id) > 191 THEN
    RAISE EXCEPTION 'Case-message preflight input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config(
       'app.user_id',
       p_actor_user_id,
       true
     ) <> p_actor_user_id THEN
    RAISE EXCEPTION 'Case-message actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  SELECT actor.role, actor.banned, actor."deletedAt"
    INTO actor_role, actor_banned, actor_deleted_at
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND
     OR actor_banned
     OR actor_deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    case_row.id,
    case_row."orderId",
    case_row."buyerId",
    case_row."sellerId",
    case_row.status::text,
    CASE
      WHEN p_actor_user_id = case_row."buyerId" THEN 'BUYER'::text
      WHEN p_actor_user_id = case_row."sellerId" THEN 'SELLER'::text
      ELSE 'STAFF'::text
    END,
    (
      p_actor_user_id IS DISTINCT FROM case_row."buyerId"
      AND p_actor_user_id IS DISTINCT FROM case_row."sellerId"
    ) AS acts_as_staff,
    CASE
      WHEN p_actor_user_id IN (
             case_row."buyerId",
             case_row."sellerId"
           ) THEN
        case_row.status IN (
          'OPEN'::public."CaseStatus",
          'IN_DISCUSSION'::public."CaseStatus",
          'PENDING_CLOSE'::public."CaseStatus"
        )
      ELSE
        case_row.status IN (
          'OPEN'::public."CaseStatus",
          'IN_DISCUSSION'::public."CaseStatus",
          'PENDING_CLOSE'::public."CaseStatus",
          'UNDER_REVIEW'::public."CaseStatus"
        )
    END AS can_create_message,
    CASE
      WHEN p_actor_user_id IS DISTINCT FROM case_row."buyerId"
       AND p_actor_user_id IS DISTINCT FROM case_row."sellerId" THEN
        NULL::text
      WHEN p_actor_user_id = case_row."buyerId" THEN
        CASE
          WHEN seller.id IS NULL THEN 'missing'::text
          WHEN seller."deletedAt" IS NOT NULL THEN 'deleted'::text
          WHEN seller.banned THEN 'suspended'::text
          ELSE NULL::text
        END
      ELSE
        CASE
          WHEN buyer.id IS NULL THEN 'missing'::text
          WHEN buyer."deletedAt" IS NOT NULL THEN 'deleted'::text
          WHEN buyer.banned THEN 'suspended'::text
          ELSE NULL::text
        END
    END AS recipient_unavailable_reason
    FROM public."Case" AS case_row
    LEFT JOIN public."User" AS buyer
      ON buyer.id = case_row."buyerId"
    LEFT JOIN public."User" AS seller
      ON seller.id = case_row."sellerId"
   WHERE case_row.id = p_case_id
     AND (
       p_actor_user_id IN (
         case_row."buyerId",
         case_row."sellerId"
       )
       OR actor_role IN (
         'EMPLOYEE'::public."Role",
         'ADMIN'::public."Role"
       )
     );
END
$grainline_case_message_preflight$;

REVOKE ALL ON FUNCTION
  public.grainline_case_message_preflight(text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_case_message_preflight(text, text)
  TO grainline_app_runtime;

COMMIT;
