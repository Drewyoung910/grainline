import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION,
  assertStripeWebhookEventActivationPostflightGitState,
  parseStripeWebhookEventActivationPostflightConfig,
  writeStripeWebhookEventActivationPostflightEvidence,
} from "../scripts/stripe-webhook-event-activation-production-postflight.mjs";
import {
  STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS,
  stripeWebhookEventFunctionSourceMd5,
  stripeWebhookEventFunctionSourceSha256,
  stripeWebhookEventFunctionSources,
} from "../scripts/stripe-webhook-event-function-source-catalog.mjs";
import {
  parseStripeWebhookEventActivationPostflightProofConfig,
} from "../scripts/stripe-webhook-event-activation-postflight-postgres-proof.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function environment(directory) {
  return {
    DATABASE_URL: RUNTIME_URL,
    STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_CONFIRM:
      STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_CONFIRMATION,
    STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `stripe-webhook-event-activation-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_MAIN_CI_RUN_ID: "31234567890",
    STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_MIGRATION_RUN_ID: "31234567891",
    STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
  };
}

test("postflight config accepts only the exact pooled production runtime target", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stripe-postflight-"));
  const parsed = parseStripeWebhookEventActivationPostflightConfig(
    environment(directory),
  );
  assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
  assert.equal(parsed.runtimeIdentity.runtimeRole, "grainline_app_runtime");
  assert.equal(parsed.runtimeIdentity.endpointId, "ep-plain-river-aaqg8gj4");
  assert.equal(parsed.runtimeIdentity.region, "westus3.azure");
  assert.equal(parsed.runtimeIdentity.databaseName, "neondb");

  assert.throws(
    () => parseStripeWebhookEventActivationPostflightConfig({
      ...environment(directory),
      DIRECT_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner"),
    }),
    /privileged database keys/,
  );
  assert.throws(
    () => parseStripeWebhookEventActivationPostflightConfig({
      ...environment(directory),
      OTHER_DATABASE_URL: RUNTIME_URL,
    }),
    /aliased PostgreSQL URLs/,
  );
  assert.throws(
    () => parseStripeWebhookEventActivationPostflightConfig({
      ...environment(directory),
      DATABASE_URL: RUNTIME_URL.replace("-pooler", ""),
    }),
    /pooled Neon endpoint/,
  );
  assert.throws(
    () => parseStripeWebhookEventActivationPostflightConfig({
      ...environment(directory),
      DATABASE_URL: RUNTIME_URL.replace("ep-plain-river-aaqg8gj4", "ep-wrong"),
    }),
    /does not match the reviewed runtime identity/,
  );
});

test("disposable postflight proof requires a direct loopback runtime login", () => {
  const key = "STRIPE_WEBHOOK_EVENT_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL";
  assert.throws(
    () => parseStripeWebhookEventActivationPostflightProofConfig({}),
    /is required/,
  );
  assert.throws(
    () => parseStripeWebhookEventActivationPostflightProofConfig({
      [key]: "postgresql://grainline_app_runtime:proof@remote.example/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseStripeWebhookEventActivationPostflightProofConfig({
      [key]: "postgresql://ci:proof@localhost/grainline_ci",
    }),
    /grainline_app_runtime/,
  );
  assert.doesNotThrow(
    () => parseStripeWebhookEventActivationPostflightProofConfig({
      [key]: "postgresql://grainline_app_runtime:proof@localhost:5432/grainline_ci?sslmode=disable",
    }),
  );
});

test("postflight binds an exact clean commit and fresh mode-0600 evidence", () => {
  assert.deepEqual(
    assertStripeWebhookEventActivationPostflightGitState(
      { head: RELEASE_COMMIT, status: "" },
      RELEASE_COMMIT,
    ),
    { clean: true, head: RELEASE_COMMIT },
  );
  assert.throws(
    () => assertStripeWebhookEventActivationPostflightGitState(
      { head: RELEASE_COMMIT, status: "?? residue" },
      RELEASE_COMMIT,
    ),
    /exact clean release commit/,
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stripe-evidence-"));
  const pathname = path.join(directory, "evidence.json");
  writeStripeWebhookEventActivationPostflightEvidence(pathname, {
    status: "passed",
    productionChangedByPostflight: false,
  });
  assert.equal(fs.statSync(pathname).mode & 0o777, 0o600);
  assert.throws(
    () => writeStripeWebhookEventActivationPostflightEvidence(pathname, {}),
    /EEXIST/,
  );
});

test("activation pins all six current migration function sources", () => {
  const migration = fs.readFileSync(
    "prisma/migrations/20260805060000_enable_stripe_webhook_event_rls/migration.sql",
    "utf8",
  ).replace(/\s+/g, " ");
  const sources = stripeWebhookEventFunctionSources();
  const md5 = stripeWebhookEventFunctionSourceMd5();
  const sha256 = stripeWebhookEventFunctionSourceSha256();
  assert.equal(Object.keys(sources).length, 6);
  assert.equal(Object.keys(md5).length, 6);
  assert.equal(Object.keys(sha256).length, 6);
  for (const entry of STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS) {
    assert.match(md5[entry.name], /^[0-9a-f]{32}$/);
    assert.match(sha256[entry.name], /^[0-9a-f]{64}$/);
    assert.ok(
      migration.includes(
        `'${entry.name}', '${entry.identityArguments}', '${md5[entry.name]}'`,
      ),
      `${entry.name} source hash is not byte-pinned in activation`,
    );
  }
  assert.match(
    migration,
    /pg_catalog\.md5\(procedure\.prosrc\) = expected\.source_md5/,
  );
});

test("function-source catalog selects the exact overload identity", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stripe-source-catalog-"));
  const first = path.join(root, "prisma", "migrations", "001_original");
  const second = path.join(root, "prisma", "migrations", "002_overload");
  fs.mkdirSync(first, { recursive: true });
  fs.mkdirSync(second, { recursive: true });
  const definitions = STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS.map((entry) => {
    const declarations = entry.identityArguments.length === 0
      ? ""
      : entry.identityArguments
        .split(", ")
        .map((type, index) => `p_${index} ${type}`)
        .join(", ");
    return `
CREATE FUNCTION public.${entry.name}(${declarations})
RETURNS text
LANGUAGE sql
AS $exact$ SELECT '${entry.name}-exact'::text $exact$;
`;
  }).join("\n");
  fs.writeFileSync(path.join(first, "migration.sql"), definitions);
  fs.writeFileSync(
    path.join(second, "migration.sql"),
    `
CREATE FUNCTION public.grainline_stripe_webhook_begin(
  p_event_id text,
  p_event_type text,
  p_source_object_id text
)
RETURNS text
LANGUAGE sql
AS $overload$ SELECT 'wrong-overload'::text $overload$;
`,
  );

  const sources = stripeWebhookEventFunctionSources(root);
  assert.match(sources.grainline_stripe_webhook_begin, /begin-exact/);
  assert.doesNotMatch(sources.grainline_stripe_webhook_begin, /wrong-overload/);
});

test("postflight source is read-only, actual-role, and sanitized", () => {
  const script = fs.readFileSync(
    "scripts/stripe-webhook-event-activation-production-postflight.mjs",
    "utf8",
  );
  assert.match(script, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(script, /FROM unnest\(\$1::text\[\], \$2::text\[\]\)/);
  assert.match(
    script,
    /expected\.identity_arguments\s*=\s*pg_catalog\.oidvectortypes\(procedure\.proargtypes\)/,
  );
  assert.doesNotMatch(script, /procedure\.proname = ANY\(/);
  assert.match(script, /CURRENT_USER AS current_user_name/);
  assert.match(script, /SESSION_USER AS session_user_name/);
  assert.doesNotMatch(script, /SET\s+(?:LOCAL\s+)?ROLE/i);
  assert.match(script, /direct table read/);
  assert.match(script, /begin function read-only fence/);
  assert.match(script, /"25006"/);
  assert.match(script, /databaseUrlSha256/);
  assert.doesNotMatch(script, /target:\s*Object\.freeze\(\{[\s\S]*databaseUrl,/);
  assert.match(script, /productionChangedByPostflight: false/);
});
