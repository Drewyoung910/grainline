import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = fs.readFileSync(
  "prisma/migrations/20261008120000_prepare_clerk_webhook_event_authority/migration.sql",
  "utf8",
);

function sourceFiles(root = "src") {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:mjs|ts|tsx)$/.test(entry.name)) files.push(file);
    }
  }
  walk(root);
  return files;
}

test("Clerk webhook authority preparation is additive and generation-fenced", () => {
  assert.match(migration, /ADD COLUMN "claimGeneration" bigint NOT NULL DEFAULT 0/);
  assert.match(migration, /event\."claimGeneration" = p_claim_generation/g);
  assert.match(migration, /event\.type IS DISTINCT FROM p_event_type/);
  assert.match(migration, /interval '5 minutes'/);
  assert.match(migration, /interval '90 days'/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.equal((migration.match(/SECURITY DEFINER/g) ?? []).length, 5);
  assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 5);
  assert.doesNotMatch(migration, /(?:ENABLE|FORCE) ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /(?:GRANT|REVOKE)[\s\S]{0,80}ON TABLE/i);
});

test("ordinary application source has zero direct ClerkWebhookEvent table access", () => {
  const directAccess = /\b(?:prisma|tx|client)\.clerkWebhookEvent\b|(?:FROM|JOIN|UPDATE|INTO|TABLE|DELETE\s+FROM)\s+(?:public\.)?["`]ClerkWebhookEvent["`]/i;
  const offenders = sourceFiles().filter((file) => directAccess.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("runtime role provisioning converges the five optional Clerk service functions", () => {
  const provision = fs.readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
  for (const signature of [
    'grainline_clerk_webhook_begin"(text, text)',
    'grainline_clerk_webhook_complete"(text, bigint)',
    'grainline_clerk_webhook_fail"(text, bigint, text)',
    'grainline_clerk_webhook_prune_batch"(integer)',
    'grainline_clerk_webhook_health_summary"()',
  ]) {
    assert.match(provision, new RegExp(signature.replace(/[()]/g, "\\$&")));
  }
  assert.match(provision, /FROM clerk_webhook_service/);
});

test("route reads current Clerk state and binds all finalizers to its lease generation", () => {
  const route = fs.readFileSync("src/app/api/clerk/webhook/route.ts", "utf8");
  assert.match(route, /getCurrentClerkUserIdentity\(id\)/);
  assert.match(route, /isClerkUserNotFoundError\(error\)[\s\S]*markClerkWebhookProcessed\(svixId, claimGeneration\)/);
  assert.match(route, /nextEmail: email/);
  assert.match(route, /\.\.\.\(email \? \{ email \} : \{\}\)/);
  assert.doesNotMatch(route, /emailForPersistence/);
  assert.match(route, /const claimGeneration = reservation\.claimGeneration/);
  assert.doesNotMatch(route, /first_name|last_name|email_addresses|image_url/);
  for (const match of route.matchAll(/markClerkWebhook(?:Processed|Failed)\(([^)]*)\)/g)) {
    assert.match(match[1], /claimGeneration/);
  }
});

test("CI proves the Clerk webhook package, isolates it from historical guards, and restores it last", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const verify = workflow.indexOf(
    "name: Verify Clerk webhook event authority source package",
  );
  const isolate = workflow.indexOf(
    "name: Isolate Clerk webhook event authority until historical release guards pass",
  );
  const historical = workflow.indexOf(
    "name: Verify compatible Order checkout receipt authority release",
  );
  const tests = workflow.indexOf("name: Tests");
  const forceAudit = workflow.indexOf(
    "name: Audit runtime grants after User policyless FORCE",
  );
  const restore = workflow.indexOf(
    "name: Restore Clerk webhook event authority source package",
  );
  const reverify = workflow.indexOf(
    "name: Re-verify Clerk webhook event authority source package",
  );
  const apply = workflow.indexOf(
    "name: Apply Clerk webhook event authority in disposable PostgreSQL",
  );
  const catalog = workflow.indexOf(
    "name: Verify Clerk webhook event authority catalog",
  );
  const audit = workflow.indexOf(
    "name: Audit runtime grants after Clerk webhook event authority",
  );
  const build = workflow.indexOf("name: Production build");

  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < historical && historical < tests);
  assert.ok(tests < forceAudit && forceAudit < restore);
  assert.ok(restore < reverify && reverify < apply);
  assert.ok(apply < catalog && catalog < audit && audit < build);
  assert.match(
    workflow.slice(verify, isolate),
    /tests\/clerk-webhook-receipt\.test\.mjs/,
  );

  const isolated = workflow.slice(isolate, historical);
  assert.match(
    isolated,
    /prisma\/migrations\/20261008120000_prepare_clerk_webhook_event_authority/,
  );
  for (const file of [
    "clerk-webhook-event-authority.test.mjs",
    "clerk-webhook-event-authority-postgres.test.mjs",
    "clerk-webhook-event-state.test.mjs",
    "retention-and-ops-followups.test.mjs",
  ]) {
    assert.match(isolated, new RegExp(file.replaceAll(".", "\\.")));
  }

  const replay = workflow.slice(restore, build);
  assert.match(
    replay,
    /--file=prisma\/migrations\/20261008120000_prepare_clerk_webhook_event_authority\/migration\.sql/,
  );
  assert.match(replay, /pg_catalog\.count\(\*\) = 5/);
  assert.match(replay, /claimGeneration/);
  assert.match(replay, /relation\.relrowsecurity OR relation\.relforcerowsecurity/);
});
