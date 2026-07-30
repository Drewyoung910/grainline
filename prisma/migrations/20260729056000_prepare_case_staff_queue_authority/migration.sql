-- Compatible PIN-gated staff Case queue projection. This function adds no
-- policy, table grant, row mutation or RLS state change. The old direct queue
-- and new fixed projection can coexist until the application conversion.

BEGIN;

CREATE OR REPLACE FUNCTION public.grainline_case_staff_queue(
  p_actor_user_id text,
  p_status_filter text,
  p_requested_page integer,
  p_page_size integer
)
RETURNS TABLE (
  "totalCount" bigint,
  "safePage" integer,
  cases jsonb
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_case_staff_queue$
DECLARE
  actor_role public."Role";
  actor_banned boolean;
  actor_deleted_at timestamp(3);
BEGIN
  IF p_actor_user_id IS NULL
     OR p_actor_user_id !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR (
       p_status_filter IS NOT NULL
       AND p_status_filter NOT IN (
         'OPEN',
         'IN_DISCUSSION',
         'PENDING_CLOSE',
         'UNDER_REVIEW',
         'RESOLVED',
         'CLOSED'
       )
     )
     OR p_requested_page IS NULL
     OR p_requested_page < 1
     OR p_requested_page > 1000
     OR p_page_size IS NULL
     OR p_page_size < 1
     OR p_page_size > 50 THEN
    RAISE EXCEPTION 'Case staff queue input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.set_config(
       'app.user_id',
       p_actor_user_id,
       true
     ) <> p_actor_user_id THEN
    RAISE EXCEPTION 'Case staff queue actor context was not set'
      USING ERRCODE = '55000';
  END IF;

  SELECT actor.role, actor.banned, actor."deletedAt"
    INTO actor_role, actor_banned, actor_deleted_at
    FROM public."User" AS actor
   WHERE actor.id = p_actor_user_id;
  IF NOT FOUND
     OR actor_banned
     OR actor_deleted_at IS NOT NULL
     OR actor_role NOT IN (
       'EMPLOYEE'::public."Role",
       'ADMIN'::public."Role"
     ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered_rows AS NOT MATERIALIZED (
    SELECT
      case_row.id,
      case_row."orderId",
      case_row."buyerId",
      case_row."sellerId",
      case_row.reason,
      case_row.status,
      case_row."resolvedAt",
      case_row."createdAt"
      FROM public."Case" AS case_row
     WHERE p_status_filter IS NULL
        OR case_row.status = p_status_filter::public."CaseStatus"
  ),
  pagination AS (
    SELECT
      pg_catalog.count(*)::bigint AS total_count,
      LEAST(
        p_requested_page,
        GREATEST(
          1,
          pg_catalog.ceil(
            pg_catalog.count(*)::numeric / p_page_size::numeric
          )::integer
        )
      ) AS safe_page
      FROM filtered_rows
  ),
  page_rows AS (
    SELECT filtered_row.*
      FROM filtered_rows AS filtered_row
     ORDER BY
       filtered_row."resolvedAt" ASC NULLS FIRST,
       filtered_row."createdAt" DESC,
       filtered_row.id DESC
     OFFSET (
       (SELECT pagination.safe_page FROM pagination) - 1
     ) * p_page_size
     LIMIT p_page_size
  ),
  projected_rows AS (
    SELECT
      page_row.id,
      page_row."orderId",
      page_row.reason,
      page_row.status,
      page_row."resolvedAt",
      page_row."createdAt",
      COALESCE(
        NULLIF(buyer.name, ''),
        buyer.email,
        'Deleted buyer'
      )::text AS buyer_label,
      CASE
        WHEN NULLIF(buyer.name, '') IS NOT NULL THEN buyer.email
        ELSE NULL
      END::text AS buyer_secondary_email,
      COALESCE(NULLIF(seller.name, ''), seller.email)::text AS seller_label,
      (
        SELECT pg_catalog.count(*)::bigint
          FROM public."CaseMessage" AS case_message
         WHERE case_message."caseId" = page_row.id
      ) AS message_count
      FROM page_rows AS page_row
      LEFT JOIN public."User" AS buyer
        ON buyer.id = page_row."buyerId"
      INNER JOIN public."User" AS seller
        ON seller.id = page_row."sellerId"
  )
  SELECT
    pagination.total_count,
    pagination.safe_page,
    COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', projected_row.id::text,
          'orderId', projected_row."orderId"::text,
          'buyerLabel', projected_row.buyer_label,
          'buyerSecondaryEmail', projected_row.buyer_secondary_email,
          'sellerLabel', projected_row.seller_label,
          'reason', projected_row.reason::text,
          'status', projected_row.status::text,
          'messageCount', projected_row.message_count,
          'createdAt',
            pg_catalog.to_char(
              projected_row."createdAt" AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
        )
        ORDER BY
          projected_row."resolvedAt" ASC NULLS FIRST,
          projected_row."createdAt" DESC,
          projected_row.id DESC
      ) FILTER (WHERE projected_row.id IS NOT NULL),
      '[]'::jsonb
    )
    FROM pagination
    LEFT JOIN projected_rows AS projected_row
      ON true
   GROUP BY pagination.total_count, pagination.safe_page;
END
$grainline_case_staff_queue$;

REVOKE ALL ON FUNCTION
  public.grainline_case_staff_queue(text, text, integer, integer)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_case_staff_queue(text, text, integer, integer)
  TO grainline_app_runtime;

COMMIT;
