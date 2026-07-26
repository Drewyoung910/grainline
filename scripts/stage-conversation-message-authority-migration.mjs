#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS,
} from "./conversation-message-authority-catalog.mjs";

const root = process.cwd();
const migrationName =
  "20260726022500_prepare_conversation_message_authority";
const disposableAck =
  "I_ACKNOWLEDGE_LOOPBACK_CONVERSATION_MESSAGE_AUTHORITY_STAGING";
const sources = Object.freeze([
  Object.freeze({
    path: "docs/rls-drafts/conversation-message-recipient-access.sql",
    sha256: "51ae15ebb5e54dc4b8b083566a485c98a911fdcb65e8392a7f4efaefbf84e0c1",
    firstDefinition:
      "CREATE OR REPLACE FUNCTION public.grainline_conversation_staff_report_visible(",
  }),
  Object.freeze({
    path: "docs/rls-drafts/conversation-message-service-authority.sql",
    sha256: "c9accc77575c716aecbd6da7e87f957cf7c21a3aa25b0c4274afac0d6f130f30",
    firstDefinition:
      "CREATE OR REPLACE FUNCTION public.grainline_conversation_lock_pair_core(",
  }),
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readPinnedSource(source) {
  const contents = fs.readFileSync(path.join(root, source.path), "utf8");
  const actualSha256 = sha256(contents);
  if (actualSha256 !== source.sha256) {
    throw new Error(
      `${source.path} byte pin drifted: expected ${source.sha256}, got ${actualSha256}`,
    );
  }
  const firstDefinitionIndex = contents.indexOf(source.firstDefinition);
  if (firstDefinitionIndex < 0) {
    throw new Error(`${source.path} first function definition is missing`);
  }
  const executable = contents.slice(firstDefinitionIndex).trim();
  if (
    /ALTER\s+TABLE\s+public\."(?:Conversation|Message)"/i.test(executable)
    || /CREATE\s+POLICY\b/i.test(executable)
    || /(?:GRANT|REVOKE)[\s\S]{0,120}\bON\s+TABLE\s+public\."(?:Conversation|Message)"/i
      .test(executable)
  ) {
    throw new Error(`${source.path} contains table or policy activation SQL`);
  }
  return Object.freeze({ ...source, contents, executable });
}

function sqlTextArray(values) {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",\n       ");
}

function expectedCatalogValues() {
  return CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS
    .map((entry) => `(
      '${entry.name}',
      '${entry.signature}',
      ${entry.securityDefiner},
      '${entry.language}',
      '${entry.volatility}',
      '${entry.parallelSafety}',
      ${entry.runtimeExecute}
    )`)
    .join(",\n    ");
}

function preflight() {
  const names = sqlTextArray(
    CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.map((entry) => entry.name),
  );
  return `DO $grainline_conversation_message_authority_preflight$
DECLARE
  runtime_role record;
  table_state record;
  policy_count integer;
  candidate_function_count integer;
  invariant_trigger_count integer;
BEGIN
  SELECT rolsuper, rolinherit, rolcanlogin, rolreplication, rolbypassrls
    INTO runtime_role
    FROM pg_catalog.pg_roles
   WHERE rolname = 'grainline_app_runtime';
  IF NOT FOUND
     OR runtime_role.rolsuper
     OR runtime_role.rolinherit
     OR NOT runtime_role.rolcanlogin
     OR runtime_role.rolreplication
     OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION
      'grainline_app_runtime role posture is not Conversation/Message-safe';
  END IF;

  FOR table_state IN
    SELECT class.relname, class.relrowsecurity, class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('Conversation', 'Message')
       AND class.relkind = 'r'
     ORDER BY class.relname
  LOOP
    IF table_state.relrowsecurity OR table_state.relforcerowsecurity THEN
      RAISE EXCEPTION '% RLS must remain disabled before authority preparation',
        table_state.relname;
    END IF;
  END LOOP;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation and Message tables are missing';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('Conversation', 'Message')
       AND class.relkind = 'r'
  ) <> 2 THEN
    RAISE EXCEPTION 'Conversation and Message table catalog is incomplete';
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
      'Conversation/Message policies must not exist before authority preparation';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO candidate_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY (ARRAY[
       ${names}
     ]::text[]);
  IF candidate_function_count <> 0 THEN
    RAISE EXCEPTION
      'Conversation/Message authority functions already exist: %',
      candidate_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invariant_trigger_count
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS class ON class.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
    JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = trigger.tgfoid
   WHERE namespace.nspname = 'public'
     AND trigger.tgenabled = 'O'
     AND (
       (
         class.relname = 'Conversation'
         AND trigger.tgname = 'grainline_conversation_participants_immutable'
         AND procedure.proname =
           'grainline_conversation_participants_immutable'
       )
       OR (
         class.relname = 'Message'
         AND trigger.tgname IN (
           'grainline_message_participants_match_conversation',
           'grainline_message_route_immutable',
           'grainline_message_maintain_thread_state'
         )
         AND procedure.proname = trigger.tgname
       )
     );
  IF invariant_trigger_count <> 4 THEN
    RAISE EXCEPTION
      'Conversation/Message invariant trigger catalog is incomplete: %',
      invariant_trigger_count;
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'Conversation/Message preparation requires old-application CRUD compatibility';
  END IF;
END
$grainline_conversation_message_authority_preflight$;`;
}

function postflight() {
  return `DO $grainline_conversation_message_authority_postflight$
DECLARE
  expected record;
  actual record;
  function_oid oid;
  function_count integer;
  policy_count integer;
  public_execute boolean;
  runtime_execute_grantable boolean;
  other_role_execute_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('Conversation', 'Message')
       AND (class.relrowsecurity OR class.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION
      'Conversation/Message authority preparation must retain disabled RLS';
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
      'Conversation/Message authority preparation must not install policies';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY (
       SELECT expected_name
         FROM (VALUES
           ${CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS
    .map((entry) => `('${entry.name}')`)
    .join(",\n           ")}
         ) AS expected_function(expected_name)
     );
  IF function_count <> ${CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length} THEN
    RAISE EXCEPTION
      'Conversation/Message authority function count drifted: %',
      function_count;
  END IF;

  FOR expected IN
    SELECT *
      FROM (VALUES
        ${expectedCatalogValues()}
      ) AS catalog(
        function_name,
        identity_arguments,
        security_definer,
        language_name,
        volatility,
        parallel_safety,
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
        'Conversation/Message authority function signature is missing: %(%)',
        expected.function_name,
        expected.identity_arguments;
    END IF;

    SELECT
      procedure.prosecdef,
      procedure.proleakproof,
      procedure.provolatile,
      procedure.proparallel,
      procedure.prokind,
      procedure.proconfig,
      language.lanname,
      pg_catalog.pg_get_userbyid(procedure.proowner)
      INTO actual
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_language AS language
        ON language.oid = procedure.prolang
     WHERE procedure.oid = function_oid;

    IF actual.prosecdef IS DISTINCT FROM expected.security_definer
       OR actual.proleakproof
       OR actual.provolatile IS DISTINCT FROM expected.volatility
       OR actual.proparallel IS DISTINCT FROM expected.parallel_safety
       OR actual.prokind <> 'f'
       OR actual.proconfig IS DISTINCT FROM
          ARRAY['search_path=pg_catalog']::text[]
       OR actual.lanname IS DISTINCT FROM expected.language_name
       OR actual.pg_get_userbyid IS DISTINCT FROM current_user THEN
      RAISE EXCEPTION
        'Conversation/Message authority catalog drifted for %',
        expected.function_name;
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
    ),
    EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee = (
               SELECT role.oid
                 FROM pg_catalog.pg_roles AS role
                WHERE role.rolname = 'grainline_app_runtime'
             )
         AND acl.privilege_type = 'EXECUTE'
         AND acl.is_grantable
    ),
    (
      SELECT pg_catalog.count(*)::integer
        FROM pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE acl.grantee NOT IN (
         0,
         procedure.proowner,
         (
           SELECT role.oid
             FROM pg_catalog.pg_roles AS role
            WHERE role.rolname = 'grainline_app_runtime'
         )
       )
         AND acl.privilege_type = 'EXECUTE'
    )
      INTO public_execute, runtime_execute_grantable,
           other_role_execute_count
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = function_oid;

    IF public_execute
       OR runtime_execute_grantable
       OR other_role_execute_count <> 0
       OR pg_catalog.has_function_privilege(
            'grainline_app_runtime',
            function_oid,
            'EXECUTE'
          ) IS DISTINCT FROM expected.runtime_execute THEN
      RAISE EXCEPTION
        'Conversation/Message authority ACL drifted for %',
        expected.function_name;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Conversation"',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."Message"',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'Conversation/Message preparation narrowed old-application table CRUD';
  END IF;
END
$grainline_conversation_message_authority_postflight$;`;
}

function buildCandidate() {
  const pinned = sources.map(readPinnedSource);
  const sourceManifest = pinned
    .map((source) => `-- ${source.path} sha256=${source.sha256}`)
    .join("\n");
  const migration = [
    "-- Generated disposable Conversation/Message functions-only authority candidate.",
    "-- Do not apply outside the loopback grainline_ci proof workflow.",
    sourceManifest,
    "BEGIN;",
    "SET LOCAL lock_timeout = '10s';",
    "SET LOCAL statement_timeout = '60s';",
    "SELECT pg_catalog.pg_advisory_xact_lock(\n  pg_catalog.hashtextextended('grainline.conversation-message.rls.activation', 0)\n);",
    preflight(),
    ...pinned.map((source) => source.executable),
    postflight(),
    "COMMIT;",
    "",
  ].join("\n\n");

  if (
    (migration.match(/^BEGIN;$/gm) ?? []).length !== 1
    || (migration.match(/^COMMIT;$/gm) ?? []).length !== 1
    || (migration.match(/CREATE POLICY/g) ?? []).length !== 0
    || (migration.match(/ALTER TABLE public\."(?:Conversation|Message)"/g) ?? [])
      .length !== 0
  ) {
    throw new Error(
      "Conversation/Message authority candidate crossed its functions-only boundary",
    );
  }
  return Object.freeze({ pinned, migration });
}

function assertDisposableTarget() {
  if (
    process.env.CONVERSATION_MESSAGE_AUTHORITY_STAGING_ACK !== disposableAck
  ) {
    throw new Error(
      "disposable Conversation/Message authority staging acknowledgement is missing",
    );
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) throw new Error("DIRECT_URL is required for disposable staging");
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "Conversation/Message authority migration may be staged only for loopback grainline_ci",
    );
  }
}

function stageCandidate(migration) {
  const destinationDirectory = path.join(
    root,
    "prisma",
    "migrations",
    migrationName,
  );
  const destinationPath = path.join(destinationDirectory, "migration.sql");
  if (fs.existsSync(destinationDirectory)) {
    throw new Error(
      `authority migration destination already exists: ${destinationDirectory}`,
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
    migrationName,
  );
  const destinationPath = path.join(destinationDirectory, "migration.sql");
  if (!fs.existsSync(destinationDirectory)) {
    throw new Error(
      `authority migration destination does not exist: ${destinationDirectory}`,
    );
  }
  const entries = fs.readdirSync(destinationDirectory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(destinationPath).isFile()
  ) {
    throw new Error(
      `authority migration destination contains unexpected entries: ${destinationDirectory}`,
    );
  }
  const stagedMigration = fs.readFileSync(destinationPath, "utf8");
  const expectedSha256 = sha256(migration);
  const actualSha256 = sha256(stagedMigration);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `refusing to remove drifted authority migration: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  fs.unlinkSync(destinationPath);
  fs.rmdirSync(destinationDirectory);
}

const mode = process.argv[2] ?? "--verify";
if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
  throw new Error(
    "usage: stage-conversation-message-authority-migration.mjs [--verify|--stage|--unstage]",
  );
}

const candidate = buildCandidate();
if (mode !== "--verify") {
  assertDisposableTarget();
}
if (mode === "--stage") {
  stageCandidate(candidate.migration);
} else if (mode === "--unstage") {
  unstageCandidate(candidate.migration);
}

process.stdout.write(`${JSON.stringify({
  mode,
  staged: mode === "--stage",
  unstaged: mode === "--unstage",
  migrationName,
  migrationSha256: sha256(candidate.migration),
  functionCount: CONVERSATION_MESSAGE_AUTHORITY_FUNCTIONS.length,
  sources: candidate.pinned.map((source) => ({
    path: source.path,
    sha256: source.sha256,
  })),
  rlsChanged: false,
  tableGrantsChanged: false,
  productionChanged: false,
  persistentStagingChanged: false,
}, null, 2)}\n`);
