import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationName = "20260722051500_enable_notification_rls";
const destinationDirectory = path.join(root, "prisma", "migrations", migrationName);
const destinationPath = path.join(destinationDirectory, "migration.sql");
const disposableAck = "I_ACKNOWLEDGE_DISPOSABLE_LOOPBACK_NOTIFICATION_MIGRATION";

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readPinnedSource(source) {
  const absolutePath = path.join(root, source.path);
  const contents = fs.readFileSync(absolutePath, "utf8");
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

function buildMigration() {
  const pinned = sources.map((source) => {
    const contents = readPinnedSource(source);
    return {
      ...source,
      contents: source.transactionWrapped
        ? unwrapTransaction(source.path, contents)
        : contents.trim(),
    };
  });

  const sourceManifest = pinned
    .map((source) => `-- ${source.path} sha256=${source.sha256}`)
    .join("\n");

  const preflight = `DO $grainline_notification_activation_preflight$
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
    RAISE EXCEPTION 'grainline_app_runtime role posture is not activation-safe';
  END IF;

  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO notification_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification'
     AND class.relkind = 'r';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'public.Notification is missing';
  END IF;
  IF notification_state.relrowsecurity OR notification_state.relforcerowsecurity THEN
    RAISE EXCEPTION 'Notification RLS must be disabled before initial activation';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO policy_count
    FROM pg_catalog.pg_policy AS policy
    JOIN pg_catalog.pg_class AS class ON class.oid = policy.polrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'Notification';
  IF policy_count <> 0 THEN
    RAISE EXCEPTION 'Notification must not have policies before initial activation';
  END IF;

  IF EXISTS (
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
    RAISE EXCEPTION 'Notification.relatedUserId already exists';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO candidate_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY (ARRAY[
       'grainline_notification_unread_count',
       'grainline_notification_bell',
       'grainline_notification_page',
       'grainline_notification_mark_one_read',
       'grainline_notification_mark_many_read',
       'grainline_notification_mark_conversation_read',
       'grainline_notification_export',
       'grainline_notification_recent_low_stock',
       'grainline_notification_create_core',
       'grainline_notification_create_source_fanout',
       'grainline_notification_create_social_event',
       'grainline_notification_create_message_event',
       'grainline_notification_create_case_event',
       'grainline_notification_create_commission_event',
       'grainline_notification_create_inventory_event',
       'grainline_notification_create_verification_event',
       'grainline_notification_create_moderation_event',
       'grainline_notification_create_account_warning',
       'grainline_notification_create_order_event',
       'grainline_notification_claim_back_in_stock',
       'grainline_notification_delete_for_account',
       'grainline_notification_delete_blog_comment',
       'grainline_notification_delete_seller_broadcast',
       'grainline_notification_prune_read_batch',
       'grainline_notification_prune_unread_batch'
     ]::text[]);
  IF candidate_function_count <> 0 THEN
    RAISE EXCEPTION 'Notification activation RPC names already exist';
  END IF;
END
$grainline_notification_activation_preflight$;`;

  const purge = `DO $grainline_notification_locked_purge$
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

  const postflight = `DO $grainline_notification_activation_postflight$
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
  IF NOT FOUND
     OR NOT notification_state.relrowsecurity
     OR notification_state.relforcerowsecurity THEN
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

  const migration = [
    "-- Generated disposable Notification activation candidate.",
    "-- Do not apply outside the loopback grainline_ci proof workflow.",
    sourceManifest,
    "BEGIN;",
    "SELECT pg_catalog.pg_advisory_xact_lock(\n  pg_catalog.hashtextextended('grainline.notification.rls.activation', 0)\n);",
    preflight,
    "LOCK TABLE public.\"Notification\" IN ACCESS EXCLUSIVE MODE;",
    pinned[0].contents,
    purge,
    pinned[1].contents,
    pinned[2].contents,
    postflight,
    "COMMIT;",
    "",
  ].join("\n\n");

  if ((migration.match(/^BEGIN;$/gm) ?? []).length !== 1
      || (migration.match(/^COMMIT;$/gm) ?? []).length !== 1) {
    throw new Error("candidate migration must have one outer transaction");
  }
  return { migration, pinned };
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

const mode = process.argv[2] ?? "--verify";
if (!new Set(["--verify", "--stage"]).has(mode)) {
  throw new Error("usage: stage-notification-rls-candidate-migration.mjs [--verify|--stage]");
}

const { migration, pinned } = buildMigration();
if (mode === "--stage") {
  assertDisposableTarget();
  if (fs.existsSync(destinationDirectory)) {
    throw new Error(`candidate migration destination already exists: ${destinationDirectory}`);
  }
  fs.mkdirSync(destinationDirectory, { recursive: false, mode: 0o700 });
  fs.writeFileSync(destinationPath, migration, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

process.stdout.write(`${JSON.stringify({
  mode,
  migrationName,
  staged: mode === "--stage",
  candidateSha256: sha256(migration),
  sources: pinned.map((source) => ({ path: source.path, sha256: source.sha256 })),
  productionChanged: false,
  persistentStagingChanged: false,
}, null, 2)}\n`);
