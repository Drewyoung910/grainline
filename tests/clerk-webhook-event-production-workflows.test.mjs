import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const inspection = readFileSync(
  ".github/workflows/clerk-webhook-event-production-inspection.yml",
  "utf8",
);
const release = readFileSync(
  ".github/workflows/clerk-webhook-event-authority-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const migrationPath =
  "prisma/migrations/20261008120000_prepare_clerk_webhook_event_authority/migration.sql";
const migrationDigest = createHash("sha256")
  .update(readFileSync(migrationPath))
  .digest("hex");

test("catalog inspection is exact-main, exact-CI, first-attempt, manual, and read-only", () => {
  assert.match(inspection, /name: ClerkWebhookEvent Production Inspection/u);
  assert.match(inspection, /run-name: ClerkWebhookEvent Production Inspection \[\$\{\{ inputs\.expected_state \}\}\] \$\{\{ inputs\.release_commit \}\}/u);
  assert.match(inspection, /workflow_dispatch:/u);
  assert.match(inspection, /inputs\.confirmation == 'inspect-reviewed-clerk-webhook-event-authority'/u);
  assert.match(inspection, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(inspection, /github\.run_attempt == 1/u);
  assert.match(inspection, /main\.commit\.sha !== sha/u);
  assert.match(inspection, /run\.name !== 'CI'/u);
  assert.match(inspection, /run\.event !== 'push'/u);
  assert.match(inspection, /run\.head_sha !== sha/u);
  assert.match(inspection, /run\.conclusion !== 'success'/u);
  assert.match(inspection, /group: production-database-inspections/u);
  assert.match(inspection, /environment: Production/u);
  assert.match(inspection, /guard-production-migration-runner\.mjs/u);
  assert.match(inspection, /clerk-webhook-event-production-inspect\.mjs/u);
  assert.match(inspection, /CLERK_WEBHOOK_EVENT_EXPECTED_STATE: \$\{\{ inputs\.expected_state \}\}/u);
  assert.match(inspection, /name: Preserve sanitized ClerkWebhookEvent catalog evidence\n\s+if: always\(\)/u);
  assert.match(inspection, /retention-days: 30/u);
  assert.match(inspection, new RegExp(`${migrationDigest}  ${migrationPath.replaceAll(".", "\\.")}`, "u"));
  assert.doesNotMatch(inspection, /prisma migrate deploy|ALTER TABLE|vercel|git push/iu);
});

test("inspection proves exact source and bytes before touching the owner connection", () => {
  const source = inspection.indexOf("Verify read-only ClerkWebhookEvent inspection source");
  const bytes = inspection.indexOf("Verify exact compatibility migration bytes");
  const boundary = inspection.indexOf("Verify owner connection boundary");
  const inspect = inspection.indexOf("Inspect ClerkWebhookEvent catalog read-only");
  assert.ok(source >= 0 && source < bytes && bytes < boundary && boundary < inspect);
  for (const file of [
    "tests/clerk-webhook-event-authority.test.mjs",
    "tests/clerk-webhook-event-production-inspect.test.mjs",
    "tests/clerk-webhook-event-production-workflows.test.mjs",
  ]) assert.match(inspection, new RegExp(file.replaceAll(".", "\\."), "u"));
});

test("inspection owner guard receives the exact reviewed release binding", () => {
  const guardStart = inspection.indexOf("- name: Verify owner connection boundary");
  const inspectStart = inspection.indexOf("- name: Inspect ClerkWebhookEvent catalog read-only");
  assert.ok(guardStart >= 0 && inspectStart > guardStart);
  const guard = inspection.slice(guardStart, inspectStart);
  assert.match(
    guard,
    /PRODUCTION_MIGRATION_CONFIRM: run-reviewed-production-migrations-from-main/u,
  );
  assert.match(
    guard,
    /PRODUCTION_MIGRATION_RELEASE_COMMIT: \$\{\{ inputs\.release_commit \}\}/u,
  );
  assert.match(guard, /DIRECT_URL: \$\{\{ secrets\.PRODUCTION_MIGRATION_DIRECT_URL \}\}/u);
});

test("compatibility migration release is inspection-bound, exact-main, scope-closed, and restart-safe", () => {
  assert.match(release, /name: ClerkWebhookEvent Authority Production/u);
  assert.match(release, /inputs\.confirmation == 'apply-reviewed-clerk-webhook-event-authority'/u);
  assert.match(release, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(release, /github\.run_attempt == 1/u);
  assert.match(release, /main\.commit\.sha !== sha/u);
  assert.match(release, /ci\.head_sha !== sha/u);
  assert.match(release, /inspection\.path !== '\.github\/workflows\/clerk-webhook-event-production-inspection\.yml'/u);
  assert.match(release, /inspection\.display_title !== `ClerkWebhookEvent Production Inspection \[compatible\] \$\{sha\}`/u);
  assert.doesNotMatch(release, /inspection\.name !== 'ClerkWebhookEvent Production Inspection'/u);
  assert.match(release, /inspection\.head_sha !== sha/u);
  assert.match(release, /inspection\.run_attempt !== 1/u);
  assert.match(release, /inspection\.conclusion !== 'success'/u);
  assert.match(release, /group: production-database-migrations/u);
  assert.match(release, /environment: Production/u);
  assert.match(release, /guard-production-migration-runner\.mjs/u);
  assert.match(release, /CLERK_WEBHOOK_EVENT_EXPECTED_STATE: compatible/u);
  assert.match(release, /CLERK_WEBHOOK_EVENT_EXPECTED_STATE: complete/u);
  assert.match(release, /steps\.preflight\.outputs\.state == 'pending'/u);
  assert.equal((release.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((release.match(/npx prisma migrate status/gu) ?? []).length, 2);
  assert.match(release, /npm run audit:db-grants -- --require-direct-url/u);
  assert.match(release, /name: Preserve sanitized ClerkWebhookEvent release evidence\n\s+if: always\(\)/u);
  assert.match(release, new RegExp(`${migrationDigest}  ${migrationPath.replaceAll(".", "\\.")}`, "u"));
  assert.doesNotMatch(release, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|vercel|git push/iu);
});

test("release performs source proof before owner access and inspect-status-apply-audit-postflight in order", () => {
  const source = release.indexOf("Verify ClerkWebhookEvent compatibility release source");
  const bytes = release.indexOf("Verify exact compatibility migration bytes");
  const boundary = release.indexOf("Verify owner connection boundary");
  const preflight = release.indexOf("Inspect restart-safe ClerkWebhookEvent state before apply");
  const predecessors = release.indexOf("Require every predecessor migration applied");
  const apply = release.indexOf("Apply only reviewed ClerkWebhookEvent compatibility migration");
  const status = release.indexOf("Verify complete migration status");
  const audit = release.indexOf("Audit global grants after ClerkWebhookEvent compatibility release");
  const postflight = release.indexOf("Inspect complete ClerkWebhookEvent catalog after apply");
  assert.ok(source >= 0 && source < bytes && bytes < boundary && boundary < preflight);
  assert.ok(preflight < predecessors && predecessors < apply && apply < status);
  assert.ok(status < audit && audit < postflight);
});

test("historical CI isolates the production wiring tests with their Clerk migration and replays them after restore", () => {
  for (const file of [
    "tests/clerk-webhook-event-production-inspect.test.mjs",
    "tests/clerk-webhook-event-production-workflows.test.mjs",
  ]) {
    assert.equal(ci.split(file).length - 1, 3, file);
  }
  const isolate = ci.indexOf("Isolate Clerk webhook event authority until historical release guards pass");
  const broad = ci.indexOf("      - name: Tests\n");
  const restore = ci.indexOf("Restore Clerk webhook event authority source package");
  const replay = ci.slice(
    ci.indexOf("Re-verify Clerk webhook event authority source package"),
    ci.indexOf("Apply Clerk webhook event authority in disposable PostgreSQL"),
  );
  assert.ok(isolate >= 0 && isolate < broad && restore > broad);
  assert.match(replay, /clerk-webhook-event-production-inspect\.test\.mjs/u);
  assert.match(replay, /clerk-webhook-event-production-workflows\.test\.mjs/u);
});
