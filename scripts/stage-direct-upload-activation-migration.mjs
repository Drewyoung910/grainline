#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DIRECT_UPLOAD_ACTIVATION_FUNCTIONS,
  DIRECT_UPLOAD_CLEANUP_ROLE,
} from "./direct-upload-activation-catalog.mjs";
import {
  directUploadFunctionSources,
} from "./direct-upload-function-source-catalog.mjs";

const root = process.cwd();
export const DIRECT_UPLOAD_ACTIVATION_MIGRATION =
  "20260726190500_enable_direct_upload_rls";
export const DIRECT_UPLOAD_ACTIVATION_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_DIRECT_UPLOAD_ACTIVATION_STAGING";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function functionCatalogValues() {
  const sources = directUploadFunctionSources(root);
  return DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) => `(
      ${sqlLiteral(entry.name)},
      ${sqlLiteral(entry.identityArguments)},
      ${entry.securityDefiner},
      ${sqlLiteral(createHash("md5").update(sources[entry.name]).digest("hex"))},
      ${entry.runtimeExecute},
      ${entry.cleanupExecute}
    )`).join(",\n    ");
}

function functionAclStatements() {
  const revoke = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.map((entry) =>
    `REVOKE ALL ON FUNCTION
  public.${entry.name}(${entry.identityArguments})
  FROM PUBLIC, grainline_app_runtime, ${DIRECT_UPLOAD_CLEANUP_ROLE};`
  ).join("\n");
  const runtimeGrants = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
    .filter((entry) => entry.runtimeExecute)
    .map((entry) =>
      `GRANT EXECUTE ON FUNCTION
  public.${entry.name}(${entry.identityArguments})
  TO grainline_app_runtime;`
    )
    .join("\n");
  const cleanupGrants = DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
    .filter((entry) => entry.cleanupExecute)
    .map((entry) =>
      `GRANT EXECUTE ON FUNCTION
  public.${entry.name}(${entry.identityArguments})
  TO ${DIRECT_UPLOAD_CLEANUP_ROLE};`
    )
    .join("\n");
  return `${revoke}\n${runtimeGrants}\n${cleanupGrants}`;
}

function functionCatalogProof(blockName, {
  predecessor,
} = { predecessor: false }) {
  const expectedRuntimeColumn = predecessor
    ? "predecessor_runtime_execute"
    : "activation_runtime_execute";
  const expectedCleanupColumn = predecessor
    ? "predecessor_cleanup_execute"
    : "activation_cleanup_execute";
  return `DO $${blockName}$
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
     AND procedure.proname LIKE 'grainline\\_direct\\_upload\\_%'
       ESCAPE '\\';
  IF function_count <> ${DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.length} THEN
    RAISE EXCEPTION
      'DirectUpload function catalog count drifted: %', function_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (VALUES
        ${functionCatalogValues()}
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
          ${predecessor
    ? `expected_function.activation_runtime_execute
              OR expected_function.function_name IN (
                'grainline_direct_upload_record_private_message',
                'grainline_direct_upload_cleanup_lease',
                'grainline_direct_upload_cleanup_complete',
                'grainline_direct_upload_cleanup_fail'
              )`
    : "expected_function.activation_runtime_execute"} AS predecessor_runtime_execute,
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
        '${DIRECT_UPLOAD_CLEANUP_ROLE}', procedure.oid, 'EXECUTE'
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
         expected.${expectedRuntimeColumn}
       OR actual.cleanup_execute IS DISTINCT FROM
         expected.${expectedCleanupColumn}
       OR actual.public_execute THEN
      RAISE EXCEPTION
        'DirectUpload function source, mode, owner or ACL drifted: %',
        expected.function_name;
    END IF;
  END LOOP;
END
$${blockName}$;`;
}

export function buildDirectUploadActivationCandidate() {
  const migration = `-- Generated disposable DirectUpload RLS activation candidate.
-- Do not apply outside the loopback grainline_ci proof workflow.
-- Production promotion requires the separately approved retirement migration,
-- cleanup-worker/provider proof, legacy repair residue proof and app drain.

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
   WHERE role.rolname = '${DIRECT_UPLOAD_CLEANUP_ROLE}';
  IF NOT FOUND
     OR cleanup_role.rolsuper
     OR cleanup_role.rolinherit
     OR NOT cleanup_role.rolcanlogin
     OR cleanup_role.rolcreatedb
     OR cleanup_role.rolcreaterole
     OR cleanup_role.rolreplication
     OR cleanup_role.rolbypassrls THEN
    RAISE EXCEPTION
      '${DIRECT_UPLOAD_CLEANUP_ROLE} posture is not DirectUpload-safe';
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
         '${DIRECT_UPLOAD_CLEANUP_ROLE}'
       )
       OR granted_role.rolname IN (
         'grainline_app_runtime',
         '${DIRECT_UPLOAD_CLEANUP_ROLE}'
       )
     )
       AND NOT (
         granted_role.rolname = '${DIRECT_UPLOAD_CLEANUP_ROLE}'
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
       WHERE parent.rolname = '${DIRECT_UPLOAD_CLEANUP_ROLE}'
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
           ('${DIRECT_UPLOAD_CLEANUP_ROLE}'::name)
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
         WHERE rolname = '${DIRECT_UPLOAD_CLEANUP_ROLE}')
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

${functionCatalogProof(
    "grainline_direct_upload_activation_function_preflight",
    { predecessor: true },
  )}

REVOKE ALL ON TABLE
  public."DirectUpload",
  public."DirectUploadReference"
FROM PUBLIC, grainline_app_runtime, ${DIRECT_UPLOAD_CLEANUP_ROLE};

${functionAclStatements()}

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
        ('${DIRECT_UPLOAD_CLEANUP_ROLE}'::name)
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
         WHERE rolname = '${DIRECT_UPLOAD_CLEANUP_ROLE}')
     );
  IF column_acl_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload activation retained column authority';
  END IF;
END
$grainline_direct_upload_activation_table_postflight$;

${functionCatalogProof(
    "grainline_direct_upload_activation_function_postflight",
    { predecessor: false },
  )}

COMMIT;
`;

  if (
    (migration.match(/^BEGIN;$/gm) ?? []).length !== 1
    || (migration.match(/^COMMIT;$/gm) ?? []).length !== 1
    || (migration.match(/CREATE\s+POLICY\b/gi) ?? []).length !== 0
    || (migration.match(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length !== 2
    || (migration.match(/FORCE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length !== 2
    || (migration.match(/GRANT\s+EXECUTE\s+ON\s+FUNCTION/gi) ?? []).length
      !== DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
        .filter((entry) => entry.runtimeExecute || entry.cleanupExecute).length
  ) {
    throw new Error(
      "DirectUpload activation candidate crossed its reviewed boundary",
    );
  }
  return Object.freeze({ migration, migrationSha256: sha256(migration) });
}

function assertDisposableTarget() {
  if (
    process.env.DIRECT_UPLOAD_ACTIVATION_STAGING_ACK
      !== DIRECT_UPLOAD_ACTIVATION_ACK
  ) {
    throw new Error(
      "disposable DirectUpload activation acknowledgement is missing",
    );
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) {
    throw new Error("DIRECT_URL is required for disposable activation staging");
  }
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "DirectUpload activation may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths() {
  const directory = path.join(
    root,
    "prisma",
    "migrations",
    DIRECT_UPLOAD_ACTIVATION_MIGRATION,
  );
  return Object.freeze({
    directory,
    migrationPath: path.join(directory, "migration.sql"),
  });
}

function stageCandidate(migration) {
  const { directory, migrationPath } = candidatePaths();
  if (fs.existsSync(directory)) {
    throw new Error(`activation migration destination exists: ${directory}`);
  }
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  fs.writeFileSync(migrationPath, migration, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function unstageCandidate(migration) {
  const { directory, migrationPath } = candidatePaths();
  if (!fs.existsSync(directory)) {
    throw new Error("activation migration destination does not exist");
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || sha256(fs.readFileSync(migrationPath, "utf8")) !== sha256(migration)
  ) {
    throw new Error("refusing to remove drifted activation migration");
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
    throw new Error(
      "usage: stage-direct-upload-activation-migration.mjs [--verify|--stage|--unstage]",
    );
  }
  const candidate = buildDirectUploadActivationCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: DIRECT_UPLOAD_ACTIVATION_MIGRATION,
    migrationSha256: candidate.migrationSha256,
    functionCount: DIRECT_UPLOAD_ACTIVATION_FUNCTIONS.length,
    runtimeFunctionCount: DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
      .filter((entry) => entry.runtimeExecute).length,
    cleanupFunctionCount: DIRECT_UPLOAD_ACTIVATION_FUNCTIONS
      .filter((entry) => entry.cleanupExecute).length,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeTablePrivileges: [],
    productionChanged: false,
    persistentStagingChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    process.stderr.write(
      "DirectUpload activation staging failed closed.\n",
    );
    process.exitCode = 1;
  }
}
