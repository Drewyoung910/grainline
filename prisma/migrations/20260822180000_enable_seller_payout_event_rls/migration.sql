-- Promoted reviewed policyless SellerPayoutEvent ENABLE activation.
-- FORCE RLS remains off for the later posture-only hardening release.
--
-- Policyless SellerPayoutEvent ENABLE activation after the fixed-authority
-- application has deployed and every current-credential predecessor has
-- drained. FORCE is a later posture-only release.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.seller-payout-event.rls.activation', 0)
);

LOCK TABLE public."SellerPayoutEvent" IN ACCESS EXCLUSIVE MODE;

DO $grainline_seller_payout_event_activation_preflight$
DECLARE
  table_owner oid;
  table_rls boolean;
  table_force boolean;
  migration_role record;
  runtime_role record;
  policy_count integer;
  invalid_table_acl_count integer;
  direct_column_acl_count integer;
  validated_constraint_count integer;
  required_index_count integer;
  invalid_row_count bigint;
  function_count integer;
  named_runtime_function_count integer;
  table_function_count integer;
BEGIN
  SELECT class.relowner, class.relrowsecurity, class.relforcerowsecurity
    INTO STRICT table_owner, table_rls, table_force
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerPayoutEvent'
     AND class.relkind = 'r';

  IF table_owner IS DISTINCT FROM (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION
      'SellerPayoutEvent activation requires the table owner session';
  END IF;

  SELECT role.rolsuper, role.rolbypassrls
    INTO migration_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND OR NOT (migration_role.rolsuper OR migration_role.rolbypassrls) THEN
    RAISE EXCEPTION
      'SellerPayoutEvent function owner must bypass later FORCE RLS';
  END IF;

  SELECT
    role.rolsuper,
    role.rolinherit,
    role.rolcanlogin,
    role.rolcreatedb,
    role.rolcreaterole,
    role.rolreplication,
    role.rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper
     OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolcreatedb
     OR runtime_role.rolcreaterole
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION
      'grainline_app_runtime role posture is not SellerPayoutEvent-safe';
  END IF;

  -- Neon may retain only this non-effective administrative bootstrap edge:
  -- neondb_owner is a member of the restricted runtime role, granted by
  -- cloud_admin with ADMIN but without INHERIT or SET. The runtime role never
  -- becomes a member of the owner or another privileged role.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member
        ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
      JOIN pg_catalog.pg_roles AS grantor
        ON grantor.oid = membership.grantor
     WHERE (
       member.rolname = 'grainline_app_runtime'
       OR granted_role.rolname = 'grainline_app_runtime'
     )
       AND NOT (
         granted_role.rolname = 'grainline_app_runtime'
         AND member.rolname = 'neondb_owner'
         AND grantor.rolname = 'cloud_admin'
         AND membership.admin_option
         AND NOT membership.inherit_option
         AND NOT membership.set_option
       )
  ) OR EXISTS (
    WITH RECURSIVE restricted_members AS (
      SELECT child.oid, child.rolname
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS parent
          ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
       WHERE parent.rolname = 'grainline_app_runtime'
      UNION
      SELECT child.oid, child.rolname
        FROM restricted_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership
          ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
    )
    SELECT 1
      FROM restricted_members
     WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION
      'SellerPayoutEvent runtime role retains unreviewed role membership';
  END IF;

  IF table_rls OR table_force THEN
    RAISE EXCEPTION
      'SellerPayoutEvent activation requires the clean compatible predecessor';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid = 'public."SellerPayoutEvent"'::pg_catalog.regclass;
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent service-only activation requires zero policies';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerPayoutEvent"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerPayoutEvent"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerPayoutEvent"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerPayoutEvent"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."SellerPayoutEvent"',
       'TRUNCATE,REFERENCES,TRIGGER'
     ) THEN
    RAISE EXCEPTION
      'SellerPayoutEvent predecessor runtime table grants drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_table_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerPayoutEvent'
     AND (
       acl.grantee NOT IN (
         class.relowner,
         (SELECT role.oid FROM pg_catalog.pg_roles AS role
           WHERE role.rolname = 'grainline_app_runtime')
       )
       OR (
         acl.grantee = (
           SELECT role.oid FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = 'grainline_app_runtime'
         )
         AND (
           acl.privilege_type NOT IN (
             'SELECT', 'INSERT', 'UPDATE', 'DELETE'
           )
           OR acl.grantor <> class.relowner
           OR acl.is_grantable
         )
       )
     );
  IF invalid_table_acl_count <> 0 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent predecessor table ACLs drifted: %',
      invalid_table_acl_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO direct_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid =
         'public."SellerPayoutEvent"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.privilege_type IN (
       'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
     );
  IF direct_column_acl_count <> 0 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent predecessor column ACLs drifted: %',
      direct_column_acl_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
           'public."SellerPayoutEvent"'::pg_catalog.regclass
       AND attribute.attname = 'stripeEventCreatedSeconds'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND attribute.atttypid = 'pg_catalog.int8'::pg_catalog.regtype
       AND NOT attribute.attnotnull
  ) THEN
    RAISE EXCEPTION
      'SellerPayoutEvent provider-time predecessor column drifted';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO validated_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
         'public."SellerPayoutEvent"'::pg_catalog.regclass
     AND constraint_row.conname IN (
       'SellerPayoutEvent_amount_nonnegative_chk',
       'SellerPayoutEvent_currency_chk',
       'SellerPayoutEvent_event_created_seconds_chk',
       'SellerPayoutEvent_failed_status_chk',
       'SellerPayoutEvent_source_event_chk'
     )
     AND constraint_row.contype = 'c'
     AND constraint_row.convalidated;
  IF validated_constraint_count <> 5 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent validated constraint catalog drifted: %',
      validated_constraint_count;
  END IF;

  WITH expected(
    index_name,
    is_unique,
    is_primary,
    key_columns,
    descending
  ) AS (
    VALUES
      (
        'SellerPayoutEvent_pkey', true, true,
        ARRAY['id']::text[], ARRAY[false]::boolean[]
      ),
      (
        'SellerPayoutEvent_stripePayoutId_key', true, false,
        ARRAY['stripePayoutId']::text[], ARRAY[false]::boolean[]
      ),
      (
        'SellerPayoutEvent_stripeEventId_key', true, false,
        ARRAY['stripeEventId']::text[], ARRAY[false]::boolean[]
      ),
      (
        'SellerPayoutEvent_sellerProfileId_createdAt_idx', false, false,
        ARRAY['sellerProfileId', 'createdAt']::text[],
        ARRAY[false, false]::boolean[]
      ),
      (
        'SellerPayoutEvent_seller_event_time_idx', false, false,
        ARRAY['sellerProfileId', 'stripeEventCreatedSeconds', 'id']::text[],
        ARRAY[false, true, true]::boolean[]
      ),
      (
        'SellerPayoutEvent_status_createdAt_idx', false, false,
        ARRAY['status', 'createdAt']::text[],
        ARRAY[false, false]::boolean[]
      )
  ), actual AS (
    SELECT
      index_class.relname AS index_name,
      index_row.indisunique AS is_unique,
      index_row.indisprimary AS is_primary,
      index_row.indisvalid AS is_valid,
      index_row.indisready AS is_ready,
      index_row.indislive AS is_live,
      index_row.indpred IS NULL AS is_unconditional,
      index_row.indexprs IS NULL AS has_plain_columns,
      ARRAY(
        SELECT attribute.attname::text
          FROM pg_catalog.generate_series(
            0,
            index_row.indnkeyatts - 1
          ) AS ordinal(position)
          JOIN pg_catalog.pg_attribute AS attribute
            ON attribute.attrelid = index_row.indrelid
           AND attribute.attnum = index_row.indkey[ordinal.position]
         ORDER BY ordinal.position
      ) AS key_columns,
      ARRAY(
        SELECT (index_row.indoption[ordinal.position] & 1) = 1
          FROM pg_catalog.generate_series(
            0,
            index_row.indnkeyatts - 1
          ) AS ordinal(position)
         ORDER BY ordinal.position
      ) AS descending
    FROM pg_catalog.pg_index AS index_row
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
   WHERE index_row.indrelid =
         'public."SellerPayoutEvent"'::pg_catalog.regclass
  )
  SELECT pg_catalog.count(*)::integer
    INTO required_index_count
    FROM expected
    JOIN actual
      ON actual.index_name = expected.index_name
     AND actual.is_unique = expected.is_unique
     AND actual.is_primary = expected.is_primary
     AND actual.is_valid
     AND actual.is_ready
     AND actual.is_live
     AND actual.is_unconditional
     AND actual.has_plain_columns
     AND actual.key_columns = expected.key_columns
     AND actual.descending = expected.descending;
  IF required_index_count <> 6 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent required index catalog drifted: %',
      required_index_count;
  END IF;

  SELECT pg_catalog.count(*)
    INTO invalid_row_count
    FROM public."SellerPayoutEvent" AS payout
   WHERE payout.status IS DISTINCT FROM 'failed'
      OR payout."amountCents" < 0
      OR payout.currency !~ '^[a-z]{3}$'
      OR payout."stripeEventId" IS NULL
      OR pg_catalog.char_length(pg_catalog.btrim(payout."stripeEventId"))
         NOT BETWEEN 1 AND 255
      OR payout."stripeEventCreatedSeconds" IS NULL
      OR payout."stripeEventCreatedSeconds" NOT BETWEEN 1 AND 253402300799;
  IF invalid_row_count <> 0 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent activation found invalid rows: %',
      invalid_row_count;
  END IF;

  WITH expected(
    proname,
    identity_arguments,
    language_name,
    volatility,
    parallel_safety,
    source_md5
  ) AS (
    VALUES
      (
        'grainline_seller_payout_event_apply',
        'text, bigint, bigint, text, text, integer, text, text, text',
        'plpgsql', 'v', 'u', '9968274d4bb24fad96f1cae630fab053'
      ),
      (
        'grainline_seller_payout_export_page',
        'text, integer, bigint, text',
        'plpgsql', 's', 's', 'c85609afce3075e93d6485b0bdb375e5'
      ),
      (
        'grainline_seller_payout_latest_failure',
        'text',
        'sql', 's', 's', 'ef50fcb926f6ca062d6a48b54886cbfb'
      )
  )
  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.proname = expected.proname
     AND pg_catalog.oidvectortypes(procedure.proargtypes) =
         expected.identity_arguments
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE namespace.nspname = 'public'
     AND procedure.prokind = 'f'
     AND language.lanname = expected.language_name
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.provolatile = expected.volatility
     AND procedure.proparallel = expected.parallel_safety
     AND procedure.proconfig IS NOT DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
     AND procedure.proowner = table_owner
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND (
            acl.grantee NOT IN (
              procedure.proowner,
              (SELECT role.oid FROM pg_catalog.pg_roles AS role
                WHERE role.rolname = 'grainline_app_runtime')
            )
            OR (
              acl.grantee = (
                SELECT role.oid FROM pg_catalog.pg_roles AS role
                 WHERE role.rolname = 'grainline_app_runtime'
              )
              AND (
                acl.grantor <> procedure.proowner
                OR acl.is_grantable
              )
            )
          )
     )
     AND pg_catalog.strpos(
       pg_catalog.upper(procedure.prosrc), 'EXECUTE'
     ) = 0
     AND pg_catalog.strpos(
       pg_catalog.upper(procedure.prosrc), 'FORMAT('
     ) = 0;
  IF function_count <> 3 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent fixed-function catalog drifted: %', function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO named_runtime_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       'grainline_seller_payout_event_apply',
       'grainline_seller_payout_export_page',
       'grainline_seller_payout_latest_failure'
     )
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     );
  IF named_runtime_function_count <> 3 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent trusted-name overload surface drifted: %',
      named_runtime_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO table_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND pg_catalog.has_function_privilege(
       'grainline_app_runtime', procedure.oid, 'EXECUTE'
     )
     AND pg_catalog.strpos(procedure.prosrc, '"SellerPayoutEvent"') > 0;
  IF table_function_count <> 3 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent runtime-executable direct function surface drifted: %',
      table_function_count;
  END IF;
END
$grainline_seller_payout_event_activation_preflight$;

ALTER TABLE public."SellerPayoutEvent"
  ALTER COLUMN "stripeEventCreatedSeconds" SET NOT NULL;
ALTER TABLE public."SellerPayoutEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SellerPayoutEvent" NO FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."SellerPayoutEvent"
  FROM PUBLIC, grainline_app_runtime;

DO $grainline_seller_payout_event_activation_postflight$
DECLARE
  accepted_table_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO accepted_table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'SellerPayoutEvent'
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity
     AND NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     AND NOT pg_catalog.has_any_column_privilege(
       'grainline_app_runtime', class.oid,
       'SELECT,INSERT,UPDATE,REFERENCES'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
         ) AS acl
        WHERE acl.grantee <> class.relowner
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'DELETE',
            'TRUNCATE', 'REFERENCES', 'TRIGGER'
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
        WHERE attribute.attrelid = class.oid
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND acl.privilege_type IN (
            'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
          )
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid
     )
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = class.oid
          AND attribute.attname = 'stripeEventCreatedSeconds'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
          AND attribute.attnotnull
     );
  IF accepted_table_count <> 1 THEN
    RAISE EXCEPTION
      'SellerPayoutEvent activation did not establish exact policyless posture';
  END IF;
END
$grainline_seller_payout_event_activation_postflight$;

COMMIT;
