-- Fixed staff Order mutation authority.
-- Database-first draft only; not a production migration.

CREATE OR REPLACE FUNCTION public.grainline_order_staff_mark_reviewed(
  p_actor_user_id text,
  p_order_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_staff_mark_reviewed$
DECLARE
  locked_order public."Order"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Staff Order mark-reviewed input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_user_id
       AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff Order mutation requires active staff'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT source_order.* INTO locked_order
    FROM public."Order" AS source_order
   WHERE source_order.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND
     OR locked_order."reviewNeeded" = false
     OR locked_order."labelClawbackStatus" IN ('RETRY_PENDING', 'RETRYING') THEN
    RETURN 'unchanged';
  END IF;

  UPDATE public."Order" SET "reviewNeeded" = false WHERE id = locked_order.id;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", metadata, undone, "createdAt"
  ) VALUES (
    'order-staff-reviewed:' || pg_catalog.gen_random_uuid()::text,
    p_actor_user_id, 'MARK_ORDER_REVIEWED', 'ORDER', locked_order.id,
    '{}'::jsonb, false, source_now
  );
  RETURN 'updated';
END
$grainline_order_staff_mark_reviewed$;

CREATE OR REPLACE FUNCTION public.grainline_order_staff_record_label_voided(
  p_actor_user_id text,
  p_order_id text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_staff_record_label_voided$
DECLARE
  locked_order public."Order"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  fixed_note text;
  next_note text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'Staff Order label-void input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_user_id
       AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff Order mutation requires active staff'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT source_order.* INTO locked_order
    FROM public."Order" AS source_order
   WHERE source_order.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF locked_order."labelStatus" IS DISTINCT FROM 'PURCHASED'::public."LabelStatus" THEN
    RETURN 'not_purchased';
  END IF;
  IF locked_order."labelClawbackStatus" IN ('RETRY_PENDING', 'RETRYING') THEN
    RETURN 'active_clawback';
  END IF;

  fixed_note := '[' || pg_catalog.to_char(source_now, 'YYYY-MM-DD HH24:MI:SS')
    || E' UTC]\nStaff recorded the purchased shipping label as voided or externally reconciled. Refund actions may proceed if other refund guards pass.';
  next_note := CASE WHEN COALESCE(locked_order."reviewNote", '') = ''
    THEN fixed_note ELSE locked_order."reviewNote" || E'\n\n' || fixed_note END;
  IF pg_catalog.char_length(next_note) > 10000 THEN RETURN 'too_long'; END IF;

  UPDATE public."Order"
     SET "labelStatus" = 'VOIDED'::public."LabelStatus",
         "reviewNeeded" = true,
         "reviewNote" = next_note
   WHERE id = locked_order.id;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", metadata, undone, "createdAt"
  ) VALUES (
    'order-staff-label-voided:' || pg_catalog.gen_random_uuid()::text,
    p_actor_user_id, 'RECORD_LABEL_VOIDED', 'ORDER', locked_order.id,
    pg_catalog.jsonb_build_object(
      'previousLabelStatus', 'PURCHASED', 'nextLabelStatus', 'VOIDED'
    ), false, source_now
  );
  RETURN 'updated';
END
$grainline_order_staff_record_label_voided$;

CREATE OR REPLACE FUNCTION public.grainline_order_staff_append_note(
  p_actor_user_id text,
  p_order_id text,
  p_note text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_order_staff_append_note$
DECLARE
  locked_order public."Order"%ROWTYPE;
  source_now timestamp(3) without time zone :=
    pg_catalog.clock_timestamp() AT TIME ZONE 'UTC';
  normalized_note text := pg_catalog.btrim(p_note);
  note_entry text;
  next_note text;
BEGIN
  IF p_actor_user_id IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_actor_user_id)) NOT BETWEEN 1 AND 191
     OR p_order_id IS NULL
     OR p_order_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR normalized_note IS NULL
     OR pg_catalog.char_length(normalized_note) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Staff Order note input is invalid'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM public."User" AS actor
     WHERE actor.id = p_actor_user_id
       AND actor.role::text IN ('EMPLOYEE', 'ADMIN')
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff Order mutation requires active staff'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT source_order.* INTO locked_order
    FROM public."Order" AS source_order
   WHERE source_order.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  note_entry := '[' || pg_catalog.to_char(source_now, 'YYYY-MM-DD HH24:MI:SS')
    || E' UTC]\n' || normalized_note;
  next_note := CASE WHEN COALESCE(locked_order."reviewNote", '') = ''
    THEN note_entry ELSE locked_order."reviewNote" || E'\n\n' || note_entry END;
  IF pg_catalog.char_length(next_note) > 10000 THEN RETURN 'too_long'; END IF;

  UPDATE public."Order" SET "reviewNote" = next_note WHERE id = locked_order.id;
  INSERT INTO public."AdminAuditLog" (
    id, "adminId", action, "targetType", "targetId", metadata, undone, "createdAt"
  ) VALUES (
    'order-staff-note:' || pg_catalog.gen_random_uuid()::text,
    p_actor_user_id, 'APPEND_ORDER_NOTE', 'ORDER', locked_order.id,
    '{}'::jsonb, false, source_now
  );
  RETURN 'updated';
END
$grainline_order_staff_append_note$;

REVOKE ALL ON FUNCTION public.grainline_order_staff_mark_reviewed(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_staff_record_label_voided(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_order_staff_append_note(text, text, text)
  FROM PUBLIC, grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_staff_mark_reviewed(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_staff_record_label_voided(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_order_staff_append_note(text, text, text)
  TO grainline_app_runtime;
