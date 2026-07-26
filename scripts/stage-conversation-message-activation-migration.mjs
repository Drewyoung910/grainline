#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS,
} from "./conversation-message-authority-catalog.mjs";

const root = process.cwd();
export const CONVERSATION_MESSAGE_ACTIVATION_MIGRATION =
  "20260726073000_enable_conversation_message_rls";
const policySourcePath =
  "docs/rls-drafts/conversation-message-policies.sql";
const policySourceSha256 =
  "34b70a13659ab78af85779c95788e7c1c444011950b8cdd70eeddb96605b4da7";
const firstExecutableStatement =
  'ALTER TABLE public."Conversation" ENABLE ROW LEVEL SECURITY;';
const disposableAck =
  "I_ACKNOWLEDGE_LOOPBACK_CONVERSATION_MESSAGE_ACTIVATION_STAGING";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readPinnedPolicySource() {
  const contents = fs.readFileSync(path.join(root, policySourcePath), "utf8");
  const actualSha256 = sha256(contents);
  if (actualSha256 !== policySourceSha256) {
    throw new Error(
      `${policySourcePath} byte pin drifted: expected ${policySourceSha256}, got ${actualSha256}`,
    );
  }
  const executableIndex = contents.indexOf(firstExecutableStatement);
  if (executableIndex < 0) {
    throw new Error("Conversation/Message policy executable body is missing");
  }
  const executable = contents.slice(executableIndex).trim();
  if (
    (executable.match(/CREATE\s+POLICY\b/gi) ?? []).length !== 2
    || (executable.match(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length !== 2
    || (executable.match(/NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length !== 2
    || /FOR\s+(?:INSERT|UPDATE|DELETE|ALL)\b/i.test(executable)
    || /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\b/i.test(executable)
  ) {
    throw new Error(
      "Conversation/Message policy source crossed the SELECT-only activation boundary",
    );
  }
  return Object.freeze({ contents, executable });
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function expectedFunctionValues() {
  return CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.map((entry) => `(
      ${sqlLiteral(entry.name)},
      ${sqlLiteral(entry.signature)},
      ${entry.securityDefiner},
      ${entry.runtimeExecute}
    )`).join(",\n    ");
}

function preflight() {
  return `DO $grainline_conversation_message_activation_preflight$
DECLARE
  runtime_role record;
  table_count integer;
  policy_count integer;
  function_count integer;
  expected record;
  function_oid oid;
  actual record;
BEGIN
  SELECT
    role.oid,
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
      'grainline_app_runtime role posture is not Conversation/Message-safe';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND class.relkind = 'r'
     AND NOT class.relrowsecurity
     AND NOT class.relforcerowsecurity;
  IF table_count <> 2 THEN
    RAISE EXCEPTION
      'Conversation and Message must both exist with RLS and FORCE disabled';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message');
  IF policy_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message activation requires zero predecessor policies';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"', 'DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"', 'DELETE'
     ) THEN
    RAISE EXCEPTION
      'Conversation/Message activation requires old-application CRUD predecessor grants';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname IN (
       ${CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS
    .map((entry) => sqlLiteral(entry.name))
    .join(",\n       ")}
     );
  IF function_count <> ${CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length} THEN
    RAISE EXCEPTION
      'Conversation/Message authority function overload catalog drifted: %',
      function_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (VALUES
        ${expectedFunctionValues()}
      ) AS expected_function(
        function_name,
        identity_arguments,
        security_definer,
        runtime_execute
      )
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
        'Conversation/Message authority function is missing: %(%)',
        expected.function_name,
        expected.identity_arguments;
    END IF;

    SELECT
      procedure.prosecdef,
      procedure.proleakproof,
      procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime',
        procedure.oid,
        'EXECUTE'
      ) AS runtime_execute,
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

    IF actual.prosecdef IS DISTINCT FROM expected.security_definer
       OR actual.proleakproof
       OR actual.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog']::text[]
       OR actual.owner_name IS DISTINCT FROM current_user
       OR actual.runtime_execute IS DISTINCT FROM expected.runtime_execute
       OR actual.public_execute THEN
      RAISE EXCEPTION
        'Conversation/Message authority function or ACL drifted: %',
        expected.function_name;
    END IF;
  END LOOP;
END
$grainline_conversation_message_activation_preflight$;`;
}

function postflight() {
  return `DO $grainline_conversation_message_activation_postflight$
DECLARE
  runtime_role_oid oid;
  table_count integer;
  policy_count integer;
  bad_policy_count integer;
  bad_table_acl_count integer;
  bad_column_acl_count integer;
BEGIN
  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';

  SELECT pg_catalog.count(*)::integer
    INTO table_count
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND class.relkind = 'r'
     AND class.relrowsecurity
     AND NOT class.relforcerowsecurity;
  IF table_count <> 2 THEN
    RAISE EXCEPTION
      'Conversation/Message activation did not retain exact ENABLE plus NO FORCE state';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) FILTER (
      WHERE policy.polname NOT IN (
        'grainline_conversation_participant_or_reported_select',
        'grainline_message_participant_or_reported_select'
      )
      OR policy.polcmd <> 'r'
      OR NOT policy.polpermissive
      OR policy.polroles IS DISTINCT FROM ARRAY[runtime_role_oid]::oid[]
      OR policy.polqual IS NULL
      OR policy.polwithcheck IS NOT NULL
      OR (
        class.relname = 'Conversation'
        AND policy.polname <>
          'grainline_conversation_participant_or_reported_select'
      )
      OR (
        class.relname = 'Message'
        AND policy.polname <>
          'grainline_message_participant_or_reported_select'
      )
    )::integer
    INTO policy_count, bad_policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message');
  IF policy_count <> 2 OR bad_policy_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message exact SELECT policy catalog drifted: count=% bad=%',
      policy_count,
      bad_policy_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO bad_table_acl_count
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
     AND class.relname IN ('Conversation', 'Message')
     AND class.relkind = 'r'
     AND acl.grantee IN (0, runtime_role_oid)
     AND (
       acl.grantee = 0
       OR acl.privilege_type <> 'SELECT'
       OR acl.is_grantable
     );
  IF bad_table_acl_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message runtime or PUBLIC table ACLs are broader than SELECT-only';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."Conversation"',
       'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."Message"',
       'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."Conversation"',
       'INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."Message"',
       'INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'Conversation/Message effective runtime table privileges are not SELECT-only';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO bad_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE namespace.nspname = 'public'
     AND class.relname IN ('Conversation', 'Message')
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee IN (0, runtime_role_oid);
  IF bad_column_acl_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message runtime or PUBLIC column ACLs must remain empty';
  END IF;
END
$grainline_conversation_message_activation_postflight$;`;
}

export function buildConversationMessageActivationCandidate() {
  const policySource = readPinnedPolicySource();
  const migration = [
    "-- Generated disposable Conversation/Message initial RLS activation candidate.",
    "-- Do not apply outside the loopback grainline_ci proof workflow.",
    `-- ${policySourcePath} sha256=${policySourceSha256}`,
    "BEGIN;",
    "SET LOCAL lock_timeout = '10s';",
    "SET LOCAL statement_timeout = '60s';",
    "SELECT pg_catalog.pg_advisory_xact_lock(\n  pg_catalog.hashtextextended('grainline.conversation-message.rls.activation', 0)\n);",
    preflight(),
    'LOCK TABLE public."Conversation", public."Message" IN ACCESS EXCLUSIVE MODE;',
    policySource.executable,
    postflight(),
    "COMMIT;",
    "",
  ].join("\n\n");

  if (
    (migration.match(/^BEGIN;$/gm) ?? []).length !== 1
    || (migration.match(/^COMMIT;$/gm) ?? []).length !== 1
    || (migration.match(/CREATE\s+POLICY\b/gi) ?? []).length !== 2
    || (migration.match(/FOR\s+(?:INSERT|UPDATE|DELETE|ALL)\b/gi) ?? []).length !== 0
    || (migration.match(/FORCE\s+ROW\s+LEVEL\s+SECURITY/gi) ?? []).length !== 2
  ) {
    throw new Error(
      "Conversation/Message activation candidate crossed its reviewed boundary",
    );
  }

  return Object.freeze({
    migration,
    policySourcePath,
    policySourceSha256,
  });
}

function assertDisposableTarget() {
  if (
    process.env.CONVERSATION_MESSAGE_ACTIVATION_STAGING_ACK !== disposableAck
  ) {
    throw new Error(
      "disposable Conversation/Message activation acknowledgement is missing",
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
      "Conversation/Message activation may be staged only for loopback grainline_ci",
    );
  }
}

function stageCandidate(migration) {
  const destinationDirectory = path.join(
    root,
    "prisma",
    "migrations",
    CONVERSATION_MESSAGE_ACTIVATION_MIGRATION,
  );
  const destinationPath = path.join(destinationDirectory, "migration.sql");
  if (fs.existsSync(destinationDirectory)) {
    throw new Error(
      `activation migration destination already exists: ${destinationDirectory}`,
    );
  }
  fs.mkdirSync(destinationDirectory, { recursive: false, mode: 0o700 });
  fs.writeFileSync(destinationPath, migration, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function unstageCandidate(migration) {
  const destinationDirectory = path.join(
    root,
    "prisma",
    "migrations",
    CONVERSATION_MESSAGE_ACTIVATION_MIGRATION,
  );
  const destinationPath = path.join(destinationDirectory, "migration.sql");
  if (!fs.existsSync(destinationDirectory)) {
    throw new Error("activation migration destination does not exist");
  }
  const entries = fs.readdirSync(destinationDirectory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(destinationPath).isFile()
  ) {
    throw new Error("activation migration destination contains unexpected entries");
  }
  const actual = fs.readFileSync(destinationPath, "utf8");
  if (sha256(actual) !== sha256(migration)) {
    throw new Error("refusing to remove drifted activation migration");
  }
  fs.unlinkSync(destinationPath);
  fs.rmdirSync(destinationDirectory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
    throw new Error(
      "usage: stage-conversation-message-activation-migration.mjs [--verify|--stage|--unstage]",
    );
  }
  const candidate = buildConversationMessageActivationCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: CONVERSATION_MESSAGE_ACTIVATION_MIGRATION,
    migrationSha256: sha256(candidate.migration),
    policySourcePath: candidate.policySourcePath,
    policySourceSha256: candidate.policySourceSha256,
    functionPreflightCount: CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length,
    rlsEnabled: true,
    rlsForced: false,
    runtimeTablePrivileges: ["SELECT"],
    productionChanged: false,
    persistentStagingChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch {
    process.stderr.write(
      "Conversation/Message activation staging failed closed.\n",
    );
    process.exitCode = 1;
  }
}
