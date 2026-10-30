BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.review_vote.rls.activation', 0)
);

-- Fixed ReviewVote writers use User -> Review -> ReviewVote ordering, while
-- the preparation delete guard makes predecessor child-first deletes fail
-- fast behind parent deletion. Freeze only ReviewVote here so either writer
-- family can drain without introducing a Review/ReviewVote lock-order cycle.
LOCK TABLE public."ReviewVote" IN ACCESS EXCLUSIVE MODE;

DO $grainline_review_vote_rls_preflight$
DECLARE
  runtime_oid oid;
  table_oid oid;
  table_owner oid;
  current_role_oid oid;
  reviewed_function text;
  expected_source_md5 text;
  expected_volatility "char";
  expected_runtime_execute boolean;
  runtime_privileges text[];
  drift_count bigint;
BEGIN
  SELECT oid INTO runtime_oid
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  IF runtime_oid IS NULL OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE oid = runtime_oid
       AND (
         rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
         OR rolreplication OR rolbypassrls
       )
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_oid
  ) THEN
    RAISE EXCEPTION 'grainline_app_runtime posture is unsafe';
  END IF;

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
  IF table_oid IS NULL
     OR table_owner IS DISTINCT FROM current_role_oid
     OR table_owner = runtime_oid
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_roles
        WHERE oid = table_owner
          AND (rolsuper OR rolbypassrls)
     ) THEN
    RAISE EXCEPTION 'ReviewVote activation owner posture is unsafe';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND (relrowsecurity OR relforcerowsecurity)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = table_oid
  ) THEN
    RAISE EXCEPTION 'ReviewVote predecessor RLS posture drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             attribute.attname::text || ':'
             || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
             || ':' || attribute.attnotnull::text
             ORDER BY attribute.attnum
           )
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = table_oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) IS DISTINCT FROM ARRAY[
    'reviewId:text:true',
    'userId:text:true',
    'value:integer:true',
    'createdAt:timestamp(3) without time zone:true'
  ]::text[] THEN
    RAISE EXCEPTION 'ReviewVote columns drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             constraint_state.conname::text || ':'
             || constraint_state.contype::text || ':'
             || pg_catalog.pg_get_constraintdef(constraint_state.oid, true)
             ORDER BY constraint_state.conname
           )
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = table_oid
       AND constraint_state.convalidated
  ) IS DISTINCT FROM ARRAY[
    'ReviewVote_pkey:p:PRIMARY KEY ("reviewId", "userId")',
    'ReviewVote_reviewId_fkey:f:FOREIGN KEY ("reviewId") REFERENCES "Review"(id) ON UPDATE CASCADE ON DELETE CASCADE',
    'ReviewVote_userId_fkey:f:FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE',
    'ReviewVote_value_one_chk:c:CHECK (value = 1)'
  ]::text[] THEN
    RAISE EXCEPTION 'ReviewVote constraints drifted';
  END IF;

  IF (
    SELECT pg_catalog.array_agg(
             index_class.relname::text || ':'
             || index_state.indisprimary::text || ':'
             || index_state.indisunique::text || ':'
             || pg_catalog.pg_get_indexdef(index_state.indexrelid)
             ORDER BY index_class.relname
           )
      FROM pg_catalog.pg_index AS index_state
      JOIN pg_catalog.pg_class AS index_class
        ON index_class.oid = index_state.indexrelid
     WHERE index_state.indrelid = table_oid
       AND index_state.indisvalid
       AND index_state.indisready
       AND NOT index_state.indisexclusion
       AND index_state.indpred IS NULL
       AND index_state.indexprs IS NULL
  ) IS DISTINCT FROM ARRAY[
    'ReviewVote_pkey:true:true:CREATE UNIQUE INDEX "ReviewVote_pkey" ON public."ReviewVote" USING btree ("reviewId", "userId")',
    'ReviewVote_userId_createdAt_reviewId_idx:false:false:CREATE INDEX "ReviewVote_userId_createdAt_reviewId_idx" ON public."ReviewVote" USING btree ("userId", "createdAt" DESC, "reviewId")'
  ]::text[] THEN
    RAISE EXCEPTION 'ReviewVote indexes drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = 'public."Review"'::pg_catalog.regclass
       AND constraint_state.conname = 'Review_helpfulCount_nonnegative_chk'
       AND constraint_state.contype = 'c'
       AND constraint_state.convalidated
       AND pg_catalog.pg_get_constraintdef(constraint_state.oid, true) =
           'CHECK ("helpfulCount" >= 0)'
  ) THEN
    RAISE EXCEPTION 'Review helpful-count constraint drifted';
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
    RAISE EXCEPTION 'ReviewVote projection drifted for % reviews', drift_count;
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
    'ReviewVote_delete_lock_guard:11',
    'ReviewVote_insert_guard:7',
    'ReviewVote_update_forbidden:19'
  ]::text[] OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND trigger_state.tgname = 'ReviewVote_insert_guard'
       AND trigger_state.tgfoid = pg_catalog.to_regprocedure(
         'public.grainline_review_vote_insert_guard()'
       )
       AND trigger_state.tgenabled = 'O'
       AND NOT trigger_state.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND trigger_state.tgname = 'ReviewVote_delete_lock_guard'
       AND trigger_state.tgfoid = pg_catalog.to_regprocedure(
         'public.grainline_review_vote_delete_lock_guard()'
       )
       AND trigger_state.tgenabled = 'O'
       AND NOT trigger_state.tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_state
     WHERE trigger_state.tgrelid = table_oid
       AND trigger_state.tgname = 'ReviewVote_update_forbidden'
       AND trigger_state.tgfoid = pg_catalog.to_regprocedure(
         'public.grainline_review_vote_update_forbidden()'
       )
       AND trigger_state.tgenabled = 'O'
       AND NOT trigger_state.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ReviewVote preparation triggers drifted';
  END IF;

  FOR reviewed_function, expected_source_md5, expected_volatility,
      expected_runtime_execute IN
    SELECT expected.identity, expected.source_md5, expected.volatility,
           expected.runtime_execute
      FROM (VALUES
        ('public.grainline_review_vote_insert_guard()', '0b00a5f1d054beacfe62fbd97547e0b9', 'v'::"char", false),
        ('public.grainline_review_vote_delete_lock_guard()', '9d1f581fc9700af36be4e60715c7d042', 'v'::"char", false),
        ('public.grainline_review_vote_update_forbidden()', '30d3d3cb1d88e9206970c2f9f103e367', 'v'::"char", false),
        ('public.grainline_review_vote_owner_toggle(text)', '509a773c1aad9a59ba750b390e965880', 'v'::"char", true),
        ('public.grainline_review_vote_owner_export()', 'f655fe4f4f6ef26db9588db34e9aece4', 's'::"char", true),
        ('public.grainline_review_vote_owner_delete_all()', '0964f37eb811ab94f7032be279ec91f0', 'v'::"char", true)
      ) AS expected(identity, source_md5, volatility, runtime_execute)
  LOOP
    IF pg_catalog.to_regprocedure(reviewed_function) IS NULL OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner ON owner.oid = procedure.proowner
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.proowner = table_owner
         AND procedure.prosecdef
         AND procedure.prokind = 'f'
         AND procedure.provolatile = expected_volatility
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
      RAISE EXCEPTION 'ReviewVote reviewed function posture drifted: %', reviewed_function;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure(
       'public.grainline_review_vote_count_after_delete()'
     ) IS NOT NULL OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.prosrc LIKE '%public."ReviewVote"%'
       AND procedure.oid <> ALL (ARRAY[
         pg_catalog.to_regprocedure('public.grainline_review_vote_insert_guard()'),
         pg_catalog.to_regprocedure('public.grainline_review_vote_delete_lock_guard()'),
         pg_catalog.to_regprocedure('public.grainline_review_vote_update_forbidden()'),
         pg_catalog.to_regprocedure('public.grainline_review_vote_owner_toggle(text)'),
         pg_catalog.to_regprocedure('public.grainline_review_vote_owner_export()'),
         pg_catalog.to_regprocedure('public.grainline_review_vote_owner_delete_all()')
       ]::oid[])
  ) THEN
    RAISE EXCEPTION 'ReviewVote has an unreviewed function reader';
  END IF;

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
       ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[] THEN
    RAISE EXCEPTION 'ReviewVote runtime predecessor grants drifted';
  END IF;
  IF EXISTS (
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
    RAISE EXCEPTION 'ReviewVote unexpected ACL drifted';
  END IF;
END
$grainline_review_vote_rls_preflight$;

-- The compatible preparation already converged every fixed writer on
-- User -> Review -> ReviewVote and installed the predecessor fail-fast
-- delete guard. Activation retains those exact reviewed functions and adds
-- only post-drain cascade count maintenance plus the owner read policy.
-- Once predecessor traffic is drained, every surviving delete path can keep
-- the public aggregate exact. This is required for hard User deletion, whose
-- FK cascade otherwise removes votes without repairing surviving Reviews.
CREATE FUNCTION public.grainline_review_vote_count_after_delete()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_review_vote_count_after_delete$
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
$grainline_review_vote_count_after_delete$;

REVOKE ALL ON FUNCTION public.grainline_review_vote_count_after_delete()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER "ReviewVote_count_after_delete"
AFTER DELETE ON public."ReviewVote"
REFERENCING OLD TABLE AS deleted_review_votes
FOR EACH STATEMENT EXECUTE FUNCTION public.grainline_review_vote_count_after_delete();

CREATE POLICY review_vote_owner_select
  ON public."ReviewVote"
  AS PERMISSIVE
  FOR SELECT
  TO grainline_app_runtime
  USING (
    "userId" = NULLIF(pg_catalog.current_setting('app.user_id', true), '')
  );

REVOKE ALL ON TABLE public."ReviewVote"
  FROM PUBLIC, grainline_app_runtime;
GRANT SELECT ON TABLE public."ReviewVote"
  TO grainline_app_runtime;

ALTER TABLE public."ReviewVote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ReviewVote" FORCE ROW LEVEL SECURITY;

DO $grainline_review_vote_rls_postflight$
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
    SELECT 1
      FROM pg_catalog.pg_class
     WHERE oid = table_oid
       AND relrowsecurity
       AND relforcerowsecurity
  ) OR (
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
    RAISE EXCEPTION 'ReviewVote owner-policy activation did not persist';
  END IF;

  FOR reviewed_function, expected_source_md5 IN
    SELECT expected.identity, expected.source_md5
      FROM (VALUES
        ('public.grainline_review_vote_owner_toggle(text)', '509a773c1aad9a59ba750b390e965880'),
        ('public.grainline_review_vote_owner_delete_all()', '0964f37eb811ab94f7032be279ec91f0')
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
      RAISE EXCEPTION 'ReviewVote activated function posture drifted: %', reviewed_function;
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
    RAISE EXCEPTION 'ReviewVote activated ACL drifted';
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
    'ReviewVote_count_after_delete:8',
    'ReviewVote_delete_lock_guard:11',
    'ReviewVote_insert_guard:7',
    'ReviewVote_update_forbidden:19'
  ]::text[] OR NOT EXISTS (
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
  ) THEN
    RAISE EXCEPTION 'ReviewVote delete-maintenance posture drifted';
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
    RAISE EXCEPTION 'ReviewVote activation created projection drift for % reviews', drift_count;
  END IF;
END
$grainline_review_vote_rls_postflight$;

COMMIT;
