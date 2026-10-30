-- Emergency rollback for ReviewVote owner-policy activation.
--
-- Run as the non-runtime table owner. After a successful database rollback,
-- reconcile the migration ledger with:
--   prisma migrate resolve --rolled-back 20261028070000_activate_review_vote_rls
-- Restore the predecessor application only after this transaction commits.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.review_vote.rls.activation', 0)
);

LOCK TABLE public."ReviewVote" IN ACCESS EXCLUSIVE MODE;

DO $grainline_review_vote_rollback_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  current_role_oid oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_runtime_execute boolean;
  runtime_privileges text[];
  drift_count bigint;
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'ReviewVote'
     AND class.relkind = 'r';
  SELECT oid INTO current_role_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = current_user;
  IF runtime_oid IS NULL OR table_oid IS NULL
     OR table_owner IS DISTINCT FROM current_role_oid
     OR table_owner = runtime_oid
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
        WHERE oid = table_owner AND (rolsuper OR rolbypassrls)
     ) OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_class
        WHERE oid = table_oid AND relrowsecurity AND relforcerowsecurity
     ) THEN
    RAISE EXCEPTION 'ReviewVote rollback owner/catalog posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             policy.polname::text || ':' || policy.polcmd::text
             ORDER BY policy.polname
           )
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
  ) IS DISTINCT FROM ARRAY['review_vote_owner_select:r']::text[] OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = table_oid
       AND NOT (
         policy.polpermissive
         AND policy.polroles = ARRAY[runtime_oid]::oid[]
         AND policy.polcmd = 'r'
         AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) =
             '("userId" = NULLIF(current_setting(''app.user_id''::text, true), ''''::text))'
         AND policy.polwithcheck IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'ReviewVote rollback policy posture drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_runtime_execute IN
    SELECT expected.identity, expected.source_md5, expected.runtime_execute
      FROM (VALUES
        ('public.grainline_review_vote_owner_toggle(text)', '665aa85a9a1ef369045fd80cfb4174de', true),
        ('public.grainline_review_vote_owner_delete_all()', '19d5b126b52eda84242168bbb58d7ba9', true),
        ('public.grainline_review_vote_owner_toggle_compatible(text)', 'b1b42c31985f06069c7f608df728672e', false),
        ('public.grainline_review_vote_owner_delete_all_compatible()', 'e0f3bcc6143107e6609cf3fe4a209410', false)
      ) AS expected(identity, source_md5, runtime_execute)
  LOOP
    IF pg_catalog.to_regprocedure(reviewed_function) IS NULL OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.proowner = table_owner
         AND procedure.prosecdef
         AND procedure.prokind = 'f'
         AND procedure.provolatile = 'v'
         AND procedure.proparallel = 'u'
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.md5(procedure.prosrc) = expected_source_md5
         AND (owner.rolsuper OR owner.rolbypassrls)
    ) OR pg_catalog.has_function_privilege(
      0, pg_catalog.to_regprocedure(reviewed_function), 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'grainline_app_runtime',
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) IS DISTINCT FROM expected_runtime_execute THEN
      RAISE EXCEPTION 'ReviewVote rollback function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;

  SELECT COALESCE(
           pg_catalog.array_agg(
             DISTINCT pg_catalog.upper(acl.privilege_type)
             ORDER BY pg_catalog.upper(acl.privilege_type)
           ),
           ARRAY[]::text[]
         )
    INTO runtime_privileges
    FROM pg_catalog.aclexplode(
      COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  IF runtime_privileges IS DISTINCT FROM ARRAY['SELECT']::text[]
     OR pg_catalog.to_regprocedure(
          'public.grainline_review_vote_count_after_delete()'
        ) IS NULL OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
        WHERE procedure.oid = pg_catalog.to_regprocedure(
          'public.grainline_review_vote_count_after_delete()'
        )
          AND procedure.proowner = table_owner
          AND procedure.prosecdef
          AND procedure.prokind = 'f'
          AND procedure.provolatile = 'v'
          AND procedure.proparallel = 'u'
          AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
          AND (owner.rolsuper OR owner.rolbypassrls)
          AND procedure.prosrc = $grainline_review_vote_count_expected$
DECLARE
  affected_review_ids text[];
BEGIN
  SELECT pg_catalog.array_agg(
           DISTINCT deleted_vote."reviewId"
           ORDER BY deleted_vote."reviewId"
         )
    INTO affected_review_ids
    FROM deleted_review_votes AS deleted_vote;
  IF affected_review_ids IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1
    FROM public."Review" AS review
   WHERE review.id = ANY (affected_review_ids)
   ORDER BY review.id
   FOR UPDATE;

  WITH exact_counts AS (
    SELECT review.id,
           pg_catalog.count(vote."reviewId")::integer AS value
      FROM public."Review" AS review
      LEFT JOIN public."ReviewVote" AS vote
        ON vote."reviewId" = review.id
     WHERE review.id = ANY (affected_review_ids)
     GROUP BY review.id
  )
  UPDATE public."Review" AS review
     SET "helpfulCount" = exact_counts.value
    FROM exact_counts
   WHERE review.id = exact_counts.id
     AND review."helpfulCount" <> exact_counts.value;
  RETURN NULL;
END;
$grainline_review_vote_count_expected$
          AND NOT pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
          AND NOT pg_catalog.has_function_privilege(
            'grainline_app_runtime', procedure.oid, 'EXECUTE'
          )
     ) OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger
        WHERE tgrelid = table_oid
          AND tgname = 'ReviewVote_count_after_delete'
          AND tgtype = 8
          AND tgfoid = pg_catalog.to_regprocedure(
            'public.grainline_review_vote_count_after_delete()'
          )
          AND tgenabled = 'O'
          AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'ReviewVote rollback activation posture drifted';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO drift_count
    FROM public."Review" AS review
    LEFT JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS value
        FROM public."ReviewVote" AS vote
       WHERE vote."reviewId" = review.id
    ) AS actual ON true
   WHERE review."helpfulCount" <> actual.value;
  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'ReviewVote rollback found projection drift for % reviews', drift_count;
  END IF;
END
$grainline_review_vote_rollback_preflight$;

-- Remove activation-only count maintenance while the table is frozen. The
-- predecessor route maintains the scalar itself and would double-update if
-- this trigger survived rollback.
DROP TRIGGER "ReviewVote_count_after_delete" ON public."ReviewVote";
DROP FUNCTION public.grainline_review_vote_count_after_delete();

REVOKE ALL ON FUNCTION public.grainline_review_vote_owner_toggle(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_review_vote_owner_delete_all()
  FROM PUBLIC, grainline_app_runtime;
DROP FUNCTION public.grainline_review_vote_owner_toggle(text);
DROP FUNCTION public.grainline_review_vote_owner_delete_all();
ALTER FUNCTION public.grainline_review_vote_owner_toggle_compatible(text)
  RENAME TO grainline_review_vote_owner_toggle;
ALTER FUNCTION public.grainline_review_vote_owner_delete_all_compatible()
  RENAME TO grainline_review_vote_owner_delete_all;
GRANT EXECUTE ON FUNCTION public.grainline_review_vote_owner_toggle(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_review_vote_owner_delete_all()
  TO grainline_app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."ReviewVote"
  TO grainline_app_runtime;
ALTER TABLE public."ReviewVote" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public."ReviewVote" DISABLE ROW LEVEL SECURITY;
DROP POLICY review_vote_owner_select ON public."ReviewVote";

DO $grainline_review_vote_rollback_postflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  reviewed_function text;
  expected_source_md5 text;
  runtime_privileges text[];
  drift_count bigint;
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  SELECT class.oid, class.relowner
    INTO table_oid, table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'ReviewVote'
     AND class.relkind = 'r';
  IF runtime_oid IS NULL OR table_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
     WHERE oid = table_oid AND NOT relrowsecurity AND NOT relforcerowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) OR pg_catalog.to_regprocedure(
    'public.grainline_review_vote_count_after_delete()'
  ) IS NOT NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
     WHERE tgrelid = table_oid
       AND tgname = 'ReviewVote_count_after_delete'
       AND NOT tgisinternal
  ) OR pg_catalog.to_regprocedure(
    'public.grainline_review_vote_owner_toggle_compatible(text)'
  ) IS NOT NULL OR pg_catalog.to_regprocedure(
    'public.grainline_review_vote_owner_delete_all_compatible()'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'ReviewVote rollback catalog did not converge';
  END IF;

  FOR reviewed_function, expected_source_md5 IN
    SELECT expected.identity, expected.source_md5
      FROM (VALUES
        ('public.grainline_review_vote_owner_toggle(text)', 'b1b42c31985f06069c7f608df728672e'),
        ('public.grainline_review_vote_owner_delete_all()', 'e0f3bcc6143107e6609cf3fe4a209410')
      ) AS expected(identity, source_md5)
  LOOP
    IF pg_catalog.to_regprocedure(reviewed_function) IS NULL OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.proowner = table_owner
         AND procedure.prosecdef
         AND procedure.prokind = 'f'
         AND procedure.provolatile = 'v'
         AND procedure.proparallel = 'u'
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND pg_catalog.md5(procedure.prosrc) = expected_source_md5
         AND (owner.rolsuper OR owner.rolbypassrls)
    ) OR pg_catalog.has_function_privilege(
      0, pg_catalog.to_regprocedure(reviewed_function), 'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
      'grainline_app_runtime',
      pg_catalog.to_regprocedure(reviewed_function),
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'ReviewVote rollback function did not converge: %', reviewed_function;
    END IF;
  END LOOP;

  SELECT COALESCE(
           pg_catalog.array_agg(
             DISTINCT pg_catalog.upper(acl.privilege_type)
             ORDER BY pg_catalog.upper(acl.privilege_type)
           ),
           ARRAY[]::text[]
         )
    INTO runtime_privileges
    FROM pg_catalog.aclexplode(
      COALESCE(
        (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
        pg_catalog.acldefault('r', table_owner)
      )
    ) AS acl
   WHERE acl.grantee = runtime_oid;
  IF runtime_privileges IS DISTINCT FROM
       ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             (SELECT relacl FROM pg_catalog.pg_class WHERE oid = table_oid),
             pg_catalog.acldefault('r', table_owner)
           )
         ) AS acl
        WHERE acl.grantee NOT IN (table_owner, runtime_oid)
     ) OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = table_oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
     ) THEN
    RAISE EXCEPTION 'ReviewVote rollback grants did not converge';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             trigger_state.tgname::text || ':' || trigger_state.tgtype::text
             ORDER BY trigger_state.tgname
           )
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND NOT trigger_state.tgisinternal
  ) IS DISTINCT FROM ARRAY[
    'ReviewVote_insert_guard:7',
    'ReviewVote_update_forbidden:19'
  ]::text[] THEN
    RAISE EXCEPTION 'ReviewVote rollback preparation triggers drifted';
  END IF;

  SELECT pg_catalog.count(*)::bigint
    INTO drift_count
    FROM public."Review" AS review
    LEFT JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS value
        FROM public."ReviewVote" AS vote
       WHERE vote."reviewId" = review.id
    ) AS actual ON true
   WHERE review."helpfulCount" <> actual.value;
  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'ReviewVote rollback created projection drift for % reviews', drift_count;
  END IF;
END
$grainline_review_vote_rollback_postflight$;

COMMIT;
