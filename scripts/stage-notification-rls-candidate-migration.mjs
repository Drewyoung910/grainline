import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const disposableAck = "I_ACKNOWLEDGE_DISPOSABLE_LOOPBACK_NOTIFICATION_MIGRATION";

const candidateDefinitions = Object.freeze({
  preparation: Object.freeze({
    migrationName: "20260722051500_prepare_notification_rls",
  }),
  activation: Object.freeze({
    migrationName: "20260722052000_enable_notification_rls",
  }),
});

const sources = Object.freeze([
  Object.freeze({
    path: "docs/rls-drafts/notification-related-user.sql",
    sha256: "d8a394e3e586a2f51c006a69415bdf04326ce3affc6f42dba2186c255325e058",
    transactionWrapped: false,
  }),
  Object.freeze({
    path: "docs/rls-drafts/notification-recipient-access.sql",
    sha256: "8b59ef1d6164be6c48330c0c2c0560f1d5c401b7aa000fa094b3a390c00f14f8",
    transactionWrapped: true,
  }),
  Object.freeze({
    path: "docs/rls-drafts/notification-service-authority.sql",
    sha256: "03ec2b5c6b7babc1c67e8e86e9505d23747242b51433e1bf8e49cc62424dbe2f",
    transactionWrapped: true,
  }),
]);

const candidateFunctionNames = Object.freeze([
  "grainline_notification_unread_count",
  "grainline_notification_bell",
  "grainline_notification_page",
  "grainline_notification_mark_one_read",
  "grainline_notification_mark_many_read",
  "grainline_notification_mark_conversation_read",
  "grainline_notification_export",
  "grainline_notification_recent_low_stock",
  "grainline_notification_create_core",
  "grainline_notification_create_source_fanout",
  "grainline_notification_create_social_event",
  "grainline_notification_create_message_event",
  "grainline_notification_create_case_event",
  "grainline_notification_create_commission_event",
  "grainline_notification_create_inventory_event",
  "grainline_notification_create_verification_event",
  "grainline_notification_create_moderation_event",
  "grainline_notification_create_account_warning",
  "grainline_notification_create_order_event",
  "grainline_notification_claim_back_in_stock",
  "grainline_notification_delete_for_account",
  "grainline_notification_delete_blog_comment",
  "grainline_notification_delete_seller_broadcast",
  "grainline_notification_prune_read_batch",
  "grainline_notification_prune_unread_batch",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readPinnedSource(source) {
  const contents = fs.readFileSync(path.join(root, source.path), "utf8");
  const actualSha256 = sha256(contents);
  if (actualSha256 !== source.sha256) {
    throw new Error(
      `${source.path} byte pin drifted: expected ${source.sha256}, got ${actualSha256}`,
    );
  }
  return contents;
}

function unwrapTransaction(sourcePath, contents) {
  const lines = contents.split("\n");
  const beginIndexes = lines.flatMap((line, index) => line === "BEGIN;" ? [index] : []);
  const commitIndexes = lines.flatMap((line, index) => line === "COMMIT;" ? [index] : []);
  if (beginIndexes.length !== 1 || commitIndexes.length !== 1) {
    throw new Error(`${sourcePath} must contain exactly one standalone BEGIN and COMMIT`);
  }
  if (beginIndexes[0] >= commitIndexes[0]) {
    throw new Error(`${sourcePath} transaction wrapper is out of order`);
  }
  lines.splice(commitIndexes[0], 1);
  lines.splice(beginIndexes[0], 1);
  return lines.join("\n").trim();
}

function exactSlice(contents, startMarker, endMarker, label) {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || start >= end) {
    throw new Error(`could not extract ${label} from byte-pinned draft`);
  }
  return contents.slice(start, end).trim();
}

function roleAndTablePreflight({ expectPrepared }) {
  const expectedFunctionCount = expectPrepared ? candidateFunctionNames.length : 0;
  const relatedColumnPredicate = expectPrepared ? "NOT EXISTS" : "EXISTS";
  const relatedColumnMessage = expectPrepared
    ? "Notification.relatedUserId is missing from preparation"
    : "Notification.relatedUserId already exists";
  const functionMessage = expectPrepared
    ? "Notification preparation RPC inventory is incomplete"
    : "Notification preparation RPC names already exist";
  const functionNameArray = candidateFunctionNames.map((name) => `'${name}'`).join(",\n       ");

  return `DO $grainline_notification_${expectPrepared ? "activation" : "preparation"}_preflight$
DECLARE
  runtime_role record;
  notification_state record;
  policy_count integer;
  candidate_function_count integer;
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
    RAISE EXCEPTION 'grainline_app_runtime role posture is not Notification-safe';
  END IF;

  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO notification_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification'
     AND class.relkind = 'r';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public.Notification is missing';
  END IF;
  IF notification_state.relrowsecurity OR notification_state.relforcerowsecurity THEN
    RAISE EXCEPTION 'Notification RLS must be disabled before ${expectPrepared ? "activation" : "preparation"}';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification';
  IF policy_count <> 0 THEN
    RAISE EXCEPTION 'Notification policies must not exist before ${expectPrepared ? "activation" : "preparation"}';
  END IF;

  IF ${relatedColumnPredicate} (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS class ON class.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname = 'Notification'
       AND attribute.attname = 'relatedUserId'
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION '${relatedColumnMessage}';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO candidate_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY (ARRAY[
       ${functionNameArray}
     ]::text[]);
  IF candidate_function_count <> ${expectedFunctionCount} THEN
    RAISE EXCEPTION '${functionMessage}: expected %, got %',
      ${expectedFunctionCount}, candidate_function_count;
  END IF;
END
$grainline_notification_${expectPrepared ? "activation" : "preparation"}_preflight$;`;
}

function preparationPostflight() {
  return `DO $grainline_notification_preparation_postflight$
DECLARE
  notification_state record;
  policy_count integer;
  candidate_function_count integer;
BEGIN
  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO notification_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification';
  IF NOT FOUND OR notification_state.relrowsecurity OR notification_state.relforcerowsecurity THEN
    RAISE EXCEPTION 'Notification preparation must retain disabled RLS';
  END IF;
  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification';
  IF policy_count <> 0 THEN
    RAISE EXCEPTION 'Notification preparation must not install policies';
  END IF;
  SELECT pg_catalog.count(*)::integer
    INTO candidate_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname LIKE 'grainline_notification_%'
     AND procedure.proname <> 'grainline_notification_preferences_valid';
  IF candidate_function_count <> ${candidateFunctionNames.length} THEN
    RAISE EXCEPTION 'Notification preparation function count drifted: %', candidate_function_count;
  END IF;
  IF NOT pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'INSERT')
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'DELETE')
     OR NOT pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'UPDATE') THEN
    RAISE EXCEPTION 'Notification preparation must retain old-application CRUD compatibility';
  END IF;
  IF pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_notification_bell(text,integer)',
       'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'grainline_app_runtime',
       'public.grainline_notification_create_social_event(text,text,public."NotificationType",text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Notification preparation function grants are not compatibility-safe';
  END IF;
END
$grainline_notification_preparation_postflight$;`;
}

function lockedPurge() {
  return `DO $grainline_notification_locked_purge$
DECLARE
  row_count_before bigint;
  deleted_count bigint;
  row_count_after bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO row_count_before FROM public."Notification";
  DELETE FROM public."Notification";
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  SELECT pg_catalog.count(*) INTO row_count_after FROM public."Notification";
  IF deleted_count <> row_count_before OR row_count_after <> 0 THEN
    RAISE EXCEPTION
      'Notification activation purge mismatch: before %, deleted %, after %',
      row_count_before, deleted_count, row_count_after;
  END IF;
END
$grainline_notification_locked_purge$;`;
}

function activationPostflight() {
  return `DO $grainline_notification_activation_postflight$
DECLARE
  notification_state record;
  policy_count integer;
BEGIN
  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO notification_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification';
  IF NOT FOUND OR NOT notification_state.relrowsecurity OR notification_state.relforcerowsecurity THEN
    RAISE EXCEPTION 'Notification must finish with ENABLE and NO FORCE';
  END IF;
  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification'
     AND policy.polname IN (
       'grainline_notification_recipient_select',
       'grainline_notification_recipient_update'
     );
  IF policy_count <> 2 THEN
    RAISE EXCEPTION 'Notification exact recipient policy pair is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public."Notification") THEN
    RAISE EXCEPTION 'Notification activation must finish with no legacy rows';
  END IF;
  IF NOT pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'SELECT')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'INSERT')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'DELETE')
     OR pg_catalog.has_table_privilege('grainline_app_runtime', 'public."Notification"', 'UPDATE')
     OR NOT pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Notification"', 'read', 'UPDATE'
     )
     OR pg_catalog.has_column_privilege(
       'grainline_app_runtime', 'public."Notification"', 'title', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Notification runtime table grants are not activation-safe';
  END IF;
END
$grainline_notification_activation_postflight$;`;
}

function wrapCandidate({ title, sourceManifest, parts }) {
  const migration = [
    `-- Generated disposable Notification ${title} candidate.`,
    "-- Do not apply outside the loopback grainline_ci proof workflow.",
    sourceManifest,
    "BEGIN;",
    "SELECT pg_catalog.pg_advisory_xact_lock(\n  pg_catalog.hashtextextended('grainline.notification.rls.activation', 0)\n);",
    ...parts,
    "COMMIT;",
    "",
  ].join("\n\n");
  if ((migration.match(/^BEGIN;$/gm) ?? []).length !== 1
      || (migration.match(/^COMMIT;$/gm) ?? []).length !== 1) {
    throw new Error(`${title} candidate migration must have one outer transaction`);
  }
  return migration;
}

function buildCandidates() {
  const pinned = sources.map((source) => {
    const contents = readPinnedSource(source);
    return {
      ...source,
      contents: source.transactionWrapped
        ? unwrapTransaction(source.path, contents)
        : contents.trim(),
    };
  });
  const lifecycle = pinned[0].contents;
  const recipient = pinned[1].contents;
  const service = pinned[2].contents;
  const sourceManifest = pinned
    .map((source) => `-- ${source.path} sha256=${source.sha256}`)
    .join("\n");

  const recipientFunctionStart = "CREATE OR REPLACE FUNCTION public.grainline_notification_unread_count(";
  const recipientTableGrantStart = "REVOKE ALL ON TABLE public.\"Notification\" FROM PUBLIC, grainline_app_runtime;";
  const recipientFunctionGrantStart = "REVOKE ALL ON FUNCTION public.grainline_notification_unread_count(text)";
  const serviceTableRevokeStart = "-- Direct cross-user table writes remain forbidden.";

  const recipientPolicies = exactSlice(
    recipient,
    "ALTER TABLE public.\"Notification\" ENABLE ROW LEVEL SECURITY;",
    recipientFunctionStart,
    "recipient policies",
  );
  const recipientFunctions = exactSlice(
    recipient,
    recipientFunctionStart,
    recipientTableGrantStart,
    "recipient function definitions",
  );
  const recipientTableGrants = exactSlice(
    recipient,
    recipientTableGrantStart,
    recipientFunctionGrantStart,
    "recipient table grants",
  );
  const recipientFunctionGrants = recipient.slice(
    recipient.indexOf(recipientFunctionGrantStart),
  ).trim();
  const serviceFunctionsAndGrants = service.slice(
    0,
    service.indexOf(serviceTableRevokeStart),
  ).trim();
  if (!recipientFunctionGrants.startsWith(recipientFunctionGrantStart)
      || !serviceFunctionsAndGrants
      || service.indexOf(serviceTableRevokeStart) < 0) {
    throw new Error("could not split byte-pinned Notification grants safely");
  }

  const preparation = wrapCandidate({
    title: "preparation",
    sourceManifest,
    parts: [
      roleAndTablePreflight({ expectPrepared: false }),
      lifecycle,
      recipientFunctions,
      recipientFunctionGrants,
      serviceFunctionsAndGrants,
      preparationPostflight(),
    ],
  });
  const activation = wrapCandidate({
    title: "activation",
    sourceManifest,
    parts: [
      roleAndTablePreflight({ expectPrepared: true }),
      "LOCK TABLE public.\"Notification\" IN ACCESS EXCLUSIVE MODE;",
      lockedPurge(),
      recipientPolicies,
      recipientTableGrants,
      activationPostflight(),
    ],
  });

  return {
    pinned,
    candidates: Object.freeze({
      preparation: Object.freeze({ ...candidateDefinitions.preparation, migration: preparation }),
      activation: Object.freeze({ ...candidateDefinitions.activation, migration: activation }),
    }),
  };
}

function assertDisposableTarget() {
  if (process.env.NOTIFICATION_RLS_DISPOSABLE_MIGRATION_ACK !== disposableAck) {
    throw new Error("disposable Notification migration acknowledgement is missing");
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) throw new Error("DIRECT_URL is required for disposable staging");
  const parsed = new URL(rawUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
      || parsed.pathname !== "/grainline_ci") {
    throw new Error("candidate migration may be staged only for loopback grainline_ci");
  }
}

function stageCandidate(candidate) {
  const destinationDirectory = path.join(root, "prisma", "migrations", candidate.migrationName);
  const destinationPath = path.join(destinationDirectory, "migration.sql");
  if (fs.existsSync(destinationDirectory)) {
    throw new Error(`candidate migration destination already exists: ${destinationDirectory}`);
  }
  fs.mkdirSync(destinationDirectory, { recursive: false, mode: 0o700 });
  fs.writeFileSync(destinationPath, candidate.migration, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

const mode = process.argv[2] ?? "--verify";
if (!new Set(["--verify", "--stage-preparation", "--stage-activation"]).has(mode)) {
  throw new Error(
    "usage: stage-notification-rls-candidate-migration.mjs [--verify|--stage-preparation|--stage-activation]",
  );
}

const built = buildCandidates();
if (mode !== "--verify") {
  assertDisposableTarget();
  stageCandidate(mode === "--stage-preparation"
    ? built.candidates.preparation
    : built.candidates.activation);
}

process.stdout.write(`${JSON.stringify({
  mode,
  staged: mode !== "--verify",
  candidates: Object.fromEntries(Object.entries(built.candidates).map(([key, candidate]) => [
    key,
    {
      migrationName: candidate.migrationName,
      sha256: sha256(candidate.migration),
    },
  ])),
  sources: built.pinned.map((source) => ({ path: source.path, sha256: source.sha256 })),
  productionChanged: false,
  persistentStagingChanged: false,
}, null, 2)}\n`);
