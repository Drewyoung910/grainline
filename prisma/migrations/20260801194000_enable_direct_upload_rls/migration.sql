-- Promoted reviewed DirectUpload service-only RLS activation migration.
-- Apply only through the guarded main-only production migration workflow after
-- the rejected v3 Cloudflare token is independently confirmed revoked.
-- Case-evidence enablement and cleanup scheduling remain separate releases.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.direct-upload.rls.activation', 0)
);

LOCK TABLE
  public."DirectUpload",
  public."DirectUploadReference"
IN ACCESS EXCLUSIVE MODE;

DO $grainline_direct_upload_activation_role_preflight$
DECLARE
  function_owner_role record;
  runtime_role record;
  cleanup_role record;
  direct_upload_state record;
  reference_state record;
  policy_count integer;
  validated_constraint_count integer;
  column_acl_count integer;
BEGIN
  SELECT role.rolsuper, role.rolbypassrls
    INTO function_owner_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;
  IF NOT FOUND
     OR NOT (
       function_owner_role.rolsuper
       OR function_owner_role.rolbypassrls
     ) THEN
    RAISE EXCEPTION
      'DirectUpload SECURITY DEFINER owner must bypass FORCE RLS';
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
      'grainline_app_runtime role posture is not DirectUpload-safe';
  END IF;

  SELECT
    role.rolsuper,
    role.rolinherit,
    role.rolcanlogin,
    role.rolcreatedb,
    role.rolcreaterole,
    role.rolreplication,
    role.rolbypassrls
    INTO cleanup_role
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_direct_upload_cleanup_v2';
  IF NOT FOUND
     OR cleanup_role.rolsuper
     OR cleanup_role.rolinherit
     OR NOT cleanup_role.rolcanlogin
     OR cleanup_role.rolcreatedb
     OR cleanup_role.rolcreaterole
     OR cleanup_role.rolreplication
     OR cleanup_role.rolbypassrls THEN
    RAISE EXCEPTION
      'grainline_direct_upload_cleanup_v2 posture is not DirectUpload-safe';
  END IF;
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
       member.rolname IN (
         'grainline_app_runtime',
         'grainline_direct_upload_cleanup_v2'
       )
       OR granted_role.rolname IN (
         'grainline_app_runtime',
         'grainline_direct_upload_cleanup_v2'
       )
     )
       AND NOT (
         granted_role.rolname = 'grainline_direct_upload_cleanup_v2'
         AND member.rolname = 'neondb_owner'
         AND grantor.rolname = 'cloud_admin'
         AND membership.admin_option
         AND NOT membership.inherit_option
         AND NOT membership.set_option
       )
  ) OR EXISTS (
    WITH RECURSIVE cleanup_members AS (
      SELECT child.oid, child.rolname
        FROM pg_catalog.pg_auth_members AS membership
        JOIN pg_catalog.pg_roles AS parent
          ON parent.oid = membership.roleid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
       WHERE parent.rolname = 'grainline_direct_upload_cleanup_v2'
      UNION
      SELECT child.oid, child.rolname
        FROM cleanup_members AS parent
        JOIN pg_catalog.pg_auth_members AS membership
          ON membership.roleid = parent.oid
        JOIN pg_catalog.pg_roles AS child
          ON child.oid = membership.member
    )
    SELECT 1
      FROM cleanup_members
     WHERE rolname <> 'neondb_owner'
  ) THEN
    RAISE EXCEPTION
      'DirectUpload runtime or cleanup role retains unreviewed role membership';
  END IF;

  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO direct_upload_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'DirectUpload'
     AND class.relkind = 'r';
  IF NOT FOUND
     OR direct_upload_state.relrowsecurity
     OR direct_upload_state.relforcerowsecurity THEN
    RAISE EXCEPTION
      'DirectUpload activation requires the clean compatible predecessor';
  END IF;

  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO reference_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'DirectUploadReference'
     AND class.relkind = 'r';
  IF NOT FOUND
     OR NOT reference_state.relrowsecurity
     OR NOT reference_state.relforcerowsecurity THEN
    RAISE EXCEPTION
      'DirectUploadReference posture drifted before activation';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid IN (
     'public."DirectUpload"'::pg_catalog.regclass,
     'public."DirectUploadReference"'::pg_catalog.regclass
   );
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload service-only activation requires zero policies';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."DirectUpload"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."DirectUpload"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."DirectUpload"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."DirectUpload"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."DirectUpload"', 'TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."DirectUpload"', 'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."DirectUpload"', 'TRIGGER'
     )
     OR EXISTS (
       SELECT 1
         FROM (VALUES
           ('grainline_app_runtime'::name),
           ('grainline_direct_upload_cleanup_v2'::name)
         ) AS checked_role(role_name)
         CROSS JOIN (VALUES
           ('DirectUploadReference'::name),
           ('DirectUpload'::name)
         ) AS checked_table(table_name)
        WHERE NOT (
          checked_role.role_name = 'grainline_app_runtime'
          AND checked_table.table_name = 'DirectUpload'
        )
          AND (
            pg_catalog.has_table_privilege(
              checked_role.role_name,
              pg_catalog.format(
                'public.%I', checked_table.table_name
              ),
              'SELECT'
            )
            OR pg_catalog.has_table_privilege(
              checked_role.role_name,
              pg_catalog.format(
                'public.%I', checked_table.table_name
              ),
              'INSERT'
            )
            OR pg_catalog.has_table_privilege(
              checked_role.role_name,
              pg_catalog.format(
                'public.%I', checked_table.table_name
              ),
              'UPDATE'
            )
            OR pg_catalog.has_table_privilege(
              checked_role.role_name,
              pg_catalog.format(
                'public.%I', checked_table.table_name
              ),
              'DELETE'
            )
            OR pg_catalog.has_table_privilege(
              checked_role.role_name,
              pg_catalog.format(
                'public.%I', checked_table.table_name
              ),
              'TRUNCATE'
            )
            OR pg_catalog.has_table_privilege(
              checked_role.role_name,
              pg_catalog.format(
                'public.%I', checked_table.table_name
              ),
              'REFERENCES'
            )
            OR pg_catalog.has_table_privilege(
              checked_role.role_name,
              pg_catalog.format(
                'public.%I', checked_table.table_name
              ),
              'TRIGGER'
            )
          )
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class AS class
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = class.relnamespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             class.relacl,
             pg_catalog.acldefault('r', class.relowner)
           )
         ) AS acl
        WHERE namespace.nspname = 'public'
          AND class.relname IN (
            'DirectUpload',
            'DirectUploadReference'
          )
          AND acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER'
          )
     ) THEN
    RAISE EXCEPTION
      'DirectUpload predecessor table authority is not exact';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid IN (
       'public."DirectUpload"'::pg_catalog.regclass,
       'public."DirectUploadReference"'::pg_catalog.regclass
     )
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee IN (
       0,
       (SELECT oid FROM pg_catalog.pg_roles
         WHERE rolname = 'grainline_app_runtime'),
       (SELECT oid FROM pg_catalog.pg_roles
         WHERE rolname = 'grainline_direct_upload_cleanup_v2')
     );
  IF column_acl_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload activation refuses predecessor column grants';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
       'public."CaseMessageAttachment"'::pg_catalog.regclass
       AND attribute.attname = 'objectKey'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION
      'CaseMessageAttachment.objectKey must be retired before activation';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO validated_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid =
     'public."DirectUpload"'::pg_catalog.regclass
     AND constraint_row.conname IN (
       'DirectUpload_userId_fkey',
       'DirectUpload_endpoint_check',
       'DirectUpload_key_endpoint_check',
       'DirectUpload_public_url_key_check',
       'DirectUpload_endpoint_storage_content_size_check',
       'DirectUpload_cleanup_lease_pair_check'
     )
     AND constraint_row.convalidated;
  IF validated_constraint_count <> 6 THEN
    RAISE EXCEPTION
      'DirectUpload constraints must all exist and be validated before activation: %',
      validated_constraint_count;
  END IF;
END
$grainline_direct_upload_activation_role_preflight$;

DO $grainline_direct_upload_activation_function_preflight$
DECLARE
  expected record;
  function_oid oid;
  actual record;
  function_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname LIKE 'grainline\_direct\_upload\_%'
       ESCAPE '\';
  IF function_count <> 35 THEN
    RAISE EXCEPTION
      'DirectUpload function catalog count drifted: %', function_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (VALUES
        (
      'grainline_direct_upload_actor_valid',
      'text',
      true,
      'f887e04a3ce2b39d499878a08bbc119c',
      false,
      false
    ),
    (
      'grainline_direct_upload_case_attachment_bind',
      '',
      true,
      '046cf4875bc9ff02b628289d178ff921',
      false,
      false
    ),
    (
      'grainline_direct_upload_case_attachment_reference_trigger',
      '',
      true,
      'e4fdaf8f2a2704b70e1c49431c133de6',
      false,
      false
    ),
    (
      'grainline_direct_upload_identity_immutable',
      '',
      false,
      'cdc92166efd2be0a8ada4e1310b91cc9',
      false,
      false
    ),
    (
      'grainline_direct_upload_message_url_core',
      'text, text',
      false,
      '31c9e5ba4695578bd12646962de2b0f7',
      false,
      false
    ),
    (
      'grainline_direct_upload_record_core',
      'text, text, text, text, text, integer, text, text, text',
      true,
      '9ac43cad05c984d81eeb2593820e602d',
      false,
      false
    ),
    (
      'grainline_direct_upload_reference_core',
      'text, text, text',
      true,
      'db38d0caa8b76f4e9c9d48eb549f6904',
      false,
      false
    ),
    (
      'grainline_direct_upload_reference_guard',
      '',
      true,
      'b10c88c1d247589c9a2068be60a0643f',
      false,
      false
    ),
    (
      'grainline_direct_upload_release_core',
      'text, text, text, text',
      true,
      '7c65079a190ffda58aa41a6af3612651',
      false,
      false
    ),
    (
      'grainline_direct_upload_release_source_core',
      'text[], text, text',
      true,
      '22e50e8f8c1370961378e646732382c4',
      false,
      false
    ),
    (
      'grainline_direct_upload_source_delete_trigger',
      '',
      true,
      'dc9654ce4d73f46ba9220b751b8d7711',
      false,
      false
    ),
    (
      'grainline_direct_upload_status_transition',
      '',
      false,
      'e64d019224b791dbe7e05c6b083e0f26',
      false,
      false
    ),
    (
      'grainline_direct_upload_sync_public_core',
      'text, text, text, text[], text[]',
      true,
      'd4670369ceb889a8d67e7c0dcdd0d07b',
      false,
      false
    ),
    (
      'grainline_direct_upload_utc_now',
      '',
      false,
      '50eccf91fadf3a36c58487764314d6e2',
      false,
      false
    ),
    (
      'grainline_direct_upload_record_processed_public',
      'text, text, text, text, text, integer',
      true,
      '832b12f3c8bce3fc7f7eb6c8d910d7c4',
      true,
      false
    ),
    (
      'grainline_direct_upload_record_presigned_public',
      'text, text, text, text, text, integer',
      true,
      '5339155bd17e8802403e75f5ea8920e6',
      true,
      false
    ),
    (
      'grainline_direct_upload_record_private_case',
      'text, text, text, text, integer',
      true,
      '84312b646850bcd49c559ed8d47f262d',
      true,
      false
    ),
    (
      'grainline_direct_upload_record_private_message',
      'text, text, text, text, integer',
      true,
      '8aafa20bad68f1be55e3c8680b1fe472',
      false,
      false
    ),
    (
      'grainline_direct_upload_verify_public',
      'text, text, text',
      true,
      'eaf208be39205002d4e26f39eda02d36',
      true,
      false
    ),
    (
      'grainline_direct_upload_owned_lookup',
      'text, text',
      true,
      'd54df639fbbe63e521f696384cdc0008',
      true,
      false
    ),
    (
      'grainline_direct_upload_reference_case_attachment',
      'text, text',
      true,
      '5f57b8badd3ec7e97dc9411c4d99b0da',
      true,
      false
    ),
    (
      'grainline_direct_upload_case_attachment_read',
      'text, text, text',
      true,
      '7b1a307ebe1f8bee1ac22fb611be7cc8',
      true,
      false
    ),
    (
      'grainline_direct_upload_cleanup_lease',
      'integer',
      true,
      '37707ee46f1adf25cdf41735ad79a5c9',
      false,
      true
    ),
    (
      'grainline_direct_upload_cleanup_complete',
      'text, text',
      true,
      'a145a78ba4a5ea561f546b87ca0cb3e8',
      false,
      true
    ),
    (
      'grainline_direct_upload_cleanup_fail',
      'text, text, text',
      true,
      '063349928083ee3408abf9d1892faa7d',
      false,
      true
    ),
    (
      'grainline_direct_upload_export',
      'text',
      true,
      '6527211cf4e3040be88207fb5573440c',
      true,
      false
    ),
    (
      'grainline_direct_upload_account_public_urls',
      'text',
      true,
      '3ab4e6d42ad381d88e042dbf5293cf3e',
      true,
      false
    ),
    (
      'grainline_direct_upload_release_for_account',
      'text',
      true,
      '2b952fb6d63017fd04437d29e146b51f',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_listing',
      'text, text',
      true,
      '4f6ba00b123515df47461e50b0941bdc',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_seller_profile',
      'text, text',
      true,
      '695d1abeb28b14f36a20e21defd41334',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_review',
      'text, text',
      true,
      'a3096bae4af6a9bcad56d758dbfc4bc6',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_blog_post',
      'text, text',
      true,
      'bbc01d9cf9e20fdc3109dbd1e2748128',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_commission_request',
      'text, text',
      true,
      'ade11756e28500c0c17f053c6e0a5b65',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_seller_broadcast',
      'text, text',
      true,
      '1602c79d3fb59aa5661ca784465200b3',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_legacy_message',
      'text, text',
      true,
      'f96d6baa158f9731956fe52d142ecddc',
      true,
      false
    )
      ) AS expected_function(
        function_name,
        identity_arguments,
        security_definer,
        source_md5,
        activation_runtime_execute,
        activation_cleanup_execute
      )
      CROSS JOIN LATERAL (
        SELECT
          expected_function.activation_runtime_execute
              OR expected_function.function_name IN (
                'grainline_direct_upload_record_private_message',
                'grainline_direct_upload_cleanup_lease',
                'grainline_direct_upload_cleanup_complete',
                'grainline_direct_upload_cleanup_fail'
              ) AS predecessor_runtime_execute,
          expected_function.activation_cleanup_execute
            AS predecessor_cleanup_execute
      ) AS predecessor
  LOOP
    function_oid := pg_catalog.to_regprocedure(
      pg_catalog.format(
        'public.%I(%s)',
        expected.function_name,
        expected.identity_arguments
      )
    );
    IF function_oid IS NULL THEN
      RAISE EXCEPTION
        'DirectUpload function is missing: %(%)',
        expected.function_name,
        expected.identity_arguments;
    END IF;

    SELECT
      procedure.prokind,
      procedure.prosecdef,
      procedure.proleakproof,
      procedure.proconfig,
      procedure.prosrc,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime', procedure.oid, 'EXECUTE'
      ) AS runtime_execute,
      pg_catalog.has_function_privilege(
        'grainline_direct_upload_cleanup_v2', procedure.oid, 'EXECUTE'
      ) AS cleanup_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute
      INTO actual
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = function_oid;

    IF actual.prokind IS DISTINCT FROM 'f'
       OR actual.prosecdef IS DISTINCT FROM expected.security_definer
       OR actual.proleakproof
       OR actual.proconfig IS DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
       OR actual.owner_name IS DISTINCT FROM current_user
       OR pg_catalog.md5(actual.prosrc) IS DISTINCT FROM expected.source_md5
       OR actual.runtime_execute IS DISTINCT FROM
         expected.predecessor_runtime_execute
       OR actual.cleanup_execute IS DISTINCT FROM
         expected.predecessor_cleanup_execute
       OR actual.public_execute THEN
      RAISE EXCEPTION
        'DirectUpload function source, mode, owner or ACL drifted: %',
        expected.function_name;
    END IF;
  END LOOP;
END
$grainline_direct_upload_activation_function_preflight$;

REVOKE ALL ON TABLE
  public."DirectUpload",
  public."DirectUploadReference"
FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_actor_valid(text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_case_attachment_bind()
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_case_attachment_reference_trigger()
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_identity_immutable()
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_message_url_core(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_core(text, text, text, text, text, integer, text, text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_reference_core(text, text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_reference_guard()
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_release_core(text, text, text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_release_source_core(text[], text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_source_delete_trigger()
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_status_transition()
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_public_core(text, text, text, text[], text[])
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_utc_now()
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_processed_public(text, text, text, text, text, integer)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_presigned_public(text, text, text, text, text, integer)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_private_case(text, text, text, text, integer)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_record_private_message(text, text, text, text, integer)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_verify_public(text, text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_owned_lookup(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_reference_case_attachment(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_case_attachment_read(text, text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_cleanup_lease(integer)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_cleanup_complete(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_cleanup_fail(text, text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_export(text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_account_public_urls(text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_release_for_account(text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_listing(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_seller_profile(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_review(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_blog_post(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_commission_request(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_seller_broadcast(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_legacy_message(text, text)
  FROM PUBLIC, grainline_app_runtime, grainline_direct_upload_cleanup_v2;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_record_processed_public(text, text, text, text, text, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_record_presigned_public(text, text, text, text, text, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_record_private_case(text, text, text, text, integer)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_verify_public(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_owned_lookup(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_reference_case_attachment(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_case_attachment_read(text, text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_export(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_account_public_urls(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_release_for_account(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_listing(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_seller_profile(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_review(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_blog_post(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_commission_request(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_seller_broadcast(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_legacy_message(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_cleanup_lease(integer)
  TO grainline_direct_upload_cleanup_v2;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_cleanup_complete(text, text)
  TO grainline_direct_upload_cleanup_v2;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_cleanup_fail(text, text, text)
  TO grainline_direct_upload_cleanup_v2;

ALTER TABLE public."DirectUpload" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DirectUpload" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."DirectUploadReference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DirectUploadReference" FORCE ROW LEVEL SECURITY;

DO $grainline_direct_upload_activation_table_postflight$
DECLARE
  table_count integer;
  policy_count integer;
  column_acl_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('DirectUpload', 'DirectUploadReference')
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND class.relforcerowsecurity;
  IF table_count <> 2 THEN
    RAISE EXCEPTION
      'DirectUpload activation did not produce exact ENABLE plus FORCE state';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
   WHERE policy.polrelid IN (
     'public."DirectUpload"'::pg_catalog.regclass,
     'public."DirectUploadReference"'::pg_catalog.regclass
   );
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload service tables must retain zero policies';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('grainline_app_runtime'::name),
        ('grainline_direct_upload_cleanup_v2'::name)
      ) AS checked_role(role_name)
      CROSS JOIN (VALUES
        ('DirectUpload'::name),
        ('DirectUploadReference'::name)
      ) AS checked_table(table_name)
     WHERE pg_catalog.has_table_privilege(
             checked_role.role_name,
             pg_catalog.format('public.%I', checked_table.table_name),
             'SELECT'
           )
        OR pg_catalog.has_table_privilege(
             checked_role.role_name,
             pg_catalog.format('public.%I', checked_table.table_name),
             'INSERT'
           )
        OR pg_catalog.has_table_privilege(
             checked_role.role_name,
             pg_catalog.format('public.%I', checked_table.table_name),
             'UPDATE'
           )
        OR pg_catalog.has_table_privilege(
             checked_role.role_name,
             pg_catalog.format('public.%I', checked_table.table_name),
             'DELETE'
           )
        OR pg_catalog.has_table_privilege(
             checked_role.role_name,
             pg_catalog.format('public.%I', checked_table.table_name),
             'TRUNCATE'
           )
        OR pg_catalog.has_table_privilege(
             checked_role.role_name,
             pg_catalog.format('public.%I', checked_table.table_name),
             'REFERENCES'
           )
        OR pg_catalog.has_table_privilege(
             checked_role.role_name,
             pg_catalog.format('public.%I', checked_table.table_name),
             'TRIGGER'
           )
  )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class AS class
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = class.relnamespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             class.relacl,
             pg_catalog.acldefault('r', class.relowner)
           )
         ) AS acl
        WHERE namespace.nspname = 'public'
          AND class.relname IN (
            'DirectUpload',
            'DirectUploadReference'
          )
          AND acl.grantee = 0
          AND acl.privilege_type IN (
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE',
            'REFERENCES',
            'TRIGGER'
          )
  ) THEN
    RAISE EXCEPTION
      'DirectUpload activation retained effective table authority';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid IN (
       'public."DirectUpload"'::pg_catalog.regclass,
       'public."DirectUploadReference"'::pg_catalog.regclass
     )
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee IN (
       0,
       (SELECT oid FROM pg_catalog.pg_roles
         WHERE rolname = 'grainline_app_runtime'),
       (SELECT oid FROM pg_catalog.pg_roles
         WHERE rolname = 'grainline_direct_upload_cleanup_v2')
     );
  IF column_acl_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload activation retained column authority';
  END IF;
END
$grainline_direct_upload_activation_table_postflight$;

DO $grainline_direct_upload_activation_function_postflight$
DECLARE
  expected record;
  function_oid oid;
  actual record;
  function_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname LIKE 'grainline\_direct\_upload\_%'
       ESCAPE '\';
  IF function_count <> 35 THEN
    RAISE EXCEPTION
      'DirectUpload function catalog count drifted: %', function_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (VALUES
        (
      'grainline_direct_upload_actor_valid',
      'text',
      true,
      'f887e04a3ce2b39d499878a08bbc119c',
      false,
      false
    ),
    (
      'grainline_direct_upload_case_attachment_bind',
      '',
      true,
      '046cf4875bc9ff02b628289d178ff921',
      false,
      false
    ),
    (
      'grainline_direct_upload_case_attachment_reference_trigger',
      '',
      true,
      'e4fdaf8f2a2704b70e1c49431c133de6',
      false,
      false
    ),
    (
      'grainline_direct_upload_identity_immutable',
      '',
      false,
      'cdc92166efd2be0a8ada4e1310b91cc9',
      false,
      false
    ),
    (
      'grainline_direct_upload_message_url_core',
      'text, text',
      false,
      '31c9e5ba4695578bd12646962de2b0f7',
      false,
      false
    ),
    (
      'grainline_direct_upload_record_core',
      'text, text, text, text, text, integer, text, text, text',
      true,
      '9ac43cad05c984d81eeb2593820e602d',
      false,
      false
    ),
    (
      'grainline_direct_upload_reference_core',
      'text, text, text',
      true,
      'db38d0caa8b76f4e9c9d48eb549f6904',
      false,
      false
    ),
    (
      'grainline_direct_upload_reference_guard',
      '',
      true,
      'b10c88c1d247589c9a2068be60a0643f',
      false,
      false
    ),
    (
      'grainline_direct_upload_release_core',
      'text, text, text, text',
      true,
      '7c65079a190ffda58aa41a6af3612651',
      false,
      false
    ),
    (
      'grainline_direct_upload_release_source_core',
      'text[], text, text',
      true,
      '22e50e8f8c1370961378e646732382c4',
      false,
      false
    ),
    (
      'grainline_direct_upload_source_delete_trigger',
      '',
      true,
      'dc9654ce4d73f46ba9220b751b8d7711',
      false,
      false
    ),
    (
      'grainline_direct_upload_status_transition',
      '',
      false,
      'e64d019224b791dbe7e05c6b083e0f26',
      false,
      false
    ),
    (
      'grainline_direct_upload_sync_public_core',
      'text, text, text, text[], text[]',
      true,
      'd4670369ceb889a8d67e7c0dcdd0d07b',
      false,
      false
    ),
    (
      'grainline_direct_upload_utc_now',
      '',
      false,
      '50eccf91fadf3a36c58487764314d6e2',
      false,
      false
    ),
    (
      'grainline_direct_upload_record_processed_public',
      'text, text, text, text, text, integer',
      true,
      '832b12f3c8bce3fc7f7eb6c8d910d7c4',
      true,
      false
    ),
    (
      'grainline_direct_upload_record_presigned_public',
      'text, text, text, text, text, integer',
      true,
      '5339155bd17e8802403e75f5ea8920e6',
      true,
      false
    ),
    (
      'grainline_direct_upload_record_private_case',
      'text, text, text, text, integer',
      true,
      '84312b646850bcd49c559ed8d47f262d',
      true,
      false
    ),
    (
      'grainline_direct_upload_record_private_message',
      'text, text, text, text, integer',
      true,
      '8aafa20bad68f1be55e3c8680b1fe472',
      false,
      false
    ),
    (
      'grainline_direct_upload_verify_public',
      'text, text, text',
      true,
      'eaf208be39205002d4e26f39eda02d36',
      true,
      false
    ),
    (
      'grainline_direct_upload_owned_lookup',
      'text, text',
      true,
      'd54df639fbbe63e521f696384cdc0008',
      true,
      false
    ),
    (
      'grainline_direct_upload_reference_case_attachment',
      'text, text',
      true,
      '5f57b8badd3ec7e97dc9411c4d99b0da',
      true,
      false
    ),
    (
      'grainline_direct_upload_case_attachment_read',
      'text, text, text',
      true,
      '7b1a307ebe1f8bee1ac22fb611be7cc8',
      true,
      false
    ),
    (
      'grainline_direct_upload_cleanup_lease',
      'integer',
      true,
      '37707ee46f1adf25cdf41735ad79a5c9',
      false,
      true
    ),
    (
      'grainline_direct_upload_cleanup_complete',
      'text, text',
      true,
      'a145a78ba4a5ea561f546b87ca0cb3e8',
      false,
      true
    ),
    (
      'grainline_direct_upload_cleanup_fail',
      'text, text, text',
      true,
      '063349928083ee3408abf9d1892faa7d',
      false,
      true
    ),
    (
      'grainline_direct_upload_export',
      'text',
      true,
      '6527211cf4e3040be88207fb5573440c',
      true,
      false
    ),
    (
      'grainline_direct_upload_account_public_urls',
      'text',
      true,
      '3ab4e6d42ad381d88e042dbf5293cf3e',
      true,
      false
    ),
    (
      'grainline_direct_upload_release_for_account',
      'text',
      true,
      '2b952fb6d63017fd04437d29e146b51f',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_listing',
      'text, text',
      true,
      '4f6ba00b123515df47461e50b0941bdc',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_seller_profile',
      'text, text',
      true,
      '695d1abeb28b14f36a20e21defd41334',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_review',
      'text, text',
      true,
      'a3096bae4af6a9bcad56d758dbfc4bc6',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_blog_post',
      'text, text',
      true,
      'bbc01d9cf9e20fdc3109dbd1e2748128',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_commission_request',
      'text, text',
      true,
      'ade11756e28500c0c17f053c6e0a5b65',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_seller_broadcast',
      'text, text',
      true,
      '1602c79d3fb59aa5661ca784465200b3',
      true,
      false
    ),
    (
      'grainline_direct_upload_sync_legacy_message',
      'text, text',
      true,
      'f96d6baa158f9731956fe52d142ecddc',
      true,
      false
    )
      ) AS expected_function(
        function_name,
        identity_arguments,
        security_definer,
        source_md5,
        activation_runtime_execute,
        activation_cleanup_execute
      )
      CROSS JOIN LATERAL (
        SELECT
          expected_function.activation_runtime_execute AS predecessor_runtime_execute,
          expected_function.activation_cleanup_execute
            AS predecessor_cleanup_execute
      ) AS predecessor
  LOOP
    function_oid := pg_catalog.to_regprocedure(
      pg_catalog.format(
        'public.%I(%s)',
        expected.function_name,
        expected.identity_arguments
      )
    );
    IF function_oid IS NULL THEN
      RAISE EXCEPTION
        'DirectUpload function is missing: %(%)',
        expected.function_name,
        expected.identity_arguments;
    END IF;

    SELECT
      procedure.prokind,
      procedure.prosecdef,
      procedure.proleakproof,
      procedure.proconfig,
      procedure.prosrc,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime', procedure.oid, 'EXECUTE'
      ) AS runtime_execute,
      pg_catalog.has_function_privilege(
        'grainline_direct_upload_cleanup_v2', procedure.oid, 'EXECUTE'
      ) AS cleanup_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute
      INTO actual
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = function_oid;

    IF actual.prokind IS DISTINCT FROM 'f'
       OR actual.prosecdef IS DISTINCT FROM expected.security_definer
       OR actual.proleakproof
       OR actual.proconfig IS DISTINCT FROM
         ARRAY['search_path=pg_catalog']::text[]
       OR actual.owner_name IS DISTINCT FROM current_user
       OR pg_catalog.md5(actual.prosrc) IS DISTINCT FROM expected.source_md5
       OR actual.runtime_execute IS DISTINCT FROM
         expected.activation_runtime_execute
       OR actual.cleanup_execute IS DISTINCT FROM
         expected.activation_cleanup_execute
       OR actual.public_execute THEN
      RAISE EXCEPTION
        'DirectUpload function source, mode, owner or ACL drifted: %',
        expected.function_name;
    END IF;
  END LOOP;
END
$grainline_direct_upload_activation_function_postflight$;

COMMIT;
