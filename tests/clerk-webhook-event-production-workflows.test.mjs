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
const enable = readFileSync(
  ".github/workflows/clerk-webhook-event-enable-production.yml",
  "utf8",
);
const force = readFileSync(
  ".github/workflows/clerk-webhook-event-force-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const migrationPath =
  "prisma/migrations/20261008120000_prepare_clerk_webhook_event_authority/migration.sql";
const migrationDigest = createHash("sha256")
  .update(readFileSync(migrationPath))
  .digest("hex");
const activationPath =
  "prisma/migrations/20261010160000_enable_clerk_webhook_event_rls/migration.sql";
const activationDigest = createHash("sha256")
  .update(readFileSync(activationPath))
  .digest("hex");
const forcePath =
  "prisma/migrations/20261013030000_force_clerk_webhook_event_rls/migration.sql";
const forceDigest = createHash("sha256")
  .update(readFileSync(forcePath))
  .digest("hex");
const releaseSuccessorPath =
  "prisma/migrations/20261013040000_add_listing_archived_at/migration.sql";
const releaseSuccessorDigest = createHash("sha256")
  .update(readFileSync(releaseSuccessorPath))
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
  assert.match(inspection, new RegExp(`${activationDigest}  ${activationPath.replaceAll(".", "\\.")}`, "u"));
  assert.match(inspection, new RegExp(`${forceDigest}  ${forcePath.replaceAll(".", "\\.")}`, "u"));
  assert.match(inspection, new RegExp(
    `${releaseSuccessorDigest}  ${releaseSuccessorPath.replaceAll(".", "\\.")}`,
    "u",
  ));
  assert.match(inspection, /- activation-compatible\n\s+- enabled\n\s+- force-compatible\n\s+- forced/u);
  assert.doesNotMatch(inspection, /prisma migrate deploy|ALTER TABLE|vercel|git push/iu);
});

test("policyless FORCE is exact-main, inspection-bound, restart-safe, and migration-only", () => {
  assert.match(force, /name: ClerkWebhookEvent FORCE Production/u);
  assert.match(force, /inputs\.confirmation == 'force-reviewed-clerk-webhook-event-rls'/u);
  assert.match(force, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(force, /github\.run_attempt == 1/u);
  assert.match(force, /main\.commit\.sha !== sha/u);
  assert.match(force, /ci\.head_sha !== sha/u);
  assert.match(force, /inspection\.path !== '\.github\/workflows\/clerk-webhook-event-production-inspection\.yml'/u);
  assert.match(force, /inspection\.display_title !== `ClerkWebhookEvent Production Inspection \[force-compatible\] \$\{sha\}`/u);
  assert.match(force, /inspection\.head_sha !== sha/u);
  assert.match(force, /inspection\.run_attempt !== 1/u);
  assert.match(force, /inspection\.conclusion !== 'success'/u);
  assert.match(force, /group: production-database-migrations/u);
  assert.match(force, /environment: Production/u);
  assert.match(force, /CLERK_WEBHOOK_EVENT_EXPECTED_STATE: force-compatible/u);
  assert.match(force, /CLERK_WEBHOOK_EVENT_EXPECTED_STATE: forced/u);
  assert.match(force, /steps\.preflight\.outputs\.state == 'enabled'/u);
  assert.equal((force.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((force.match(/assert-reviewed-pending-migrations\.mjs/gu) ?? []).length, 2);
  assert.match(force, new RegExp(`${forceDigest}  ${forcePath.replaceAll(".", "\\.")}`, "u"));
  assert.match(force, new RegExp(
    `${releaseSuccessorDigest}  ${releaseSuccessorPath.replaceAll(".", "\\.")}`,
    "u",
  ));
  assert.match(force, /application_source="9c1029303f44fd8d8c594d9ef4204a85b8eaecdd"/u);
  assert.match(force, /application_deployment="dpl_3NT37Puk7H5mS4pdjtfsVdssmB7r"/u);
  assert.doesNotMatch(force, /if \[\[ "\$candidate" > "\$migration" \]\]/u);
  assert.match(force, /mv "prisma\/migrations\/\$migration" "\$holding\/\$migration"[\s\S]*npx prisma migrate status[\s\S]*mv "\$holding\/\$migration" "prisma\/migrations\/\$migration"[\s\S]*REVIEWED_PENDING_MIGRATIONS="\$migration"[\s\S]*npx prisma migrate deploy/u);
  assert.match(readFileSync(forcePath, "utf8"), /ALTER TABLE public\."ClerkWebhookEvent" FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(force, /vercel deploy|git push/iu);
});

test("FORCE proves source before owner access and inspect-apply-postflight-audit in order", () => {
  const source = force.indexOf("Verify ClerkWebhookEvent FORCE release source");
  const bytes = force.indexOf("Verify exact ClerkWebhookEvent FORCE migration bytes");
  const boundary = force.indexOf("Verify owner connection boundary");
  const preflight = force.indexOf("Inspect restart-safe ClerkWebhookEvent state before apply");
  const apply = force.indexOf("Apply only reviewed ClerkWebhookEvent FORCE migration");
  const postflight = force.indexOf("Inspect forced ClerkWebhookEvent catalog after apply");
  const audit = force.indexOf("Audit global grants after ClerkWebhookEvent FORCE");
  assert.ok(source >= 0 && source < bytes && bytes < boundary && boundary < preflight);
  assert.ok(preflight < apply && apply < postflight && postflight < audit);
});

test("policyless ENABLE is inspection-bound, exact-main, restart-safe, and keeps FORCE separate", () => {
  assert.match(enable, /name: ClerkWebhookEvent ENABLE Production/u);
  assert.match(enable, /inputs\.confirmation == 'enable-reviewed-clerk-webhook-event-rls'/u);
  assert.match(enable, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(enable, /github\.run_attempt == 1/u);
  assert.match(enable, /main\.commit\.sha !== sha/u);
  assert.match(enable, /ci\.head_sha !== sha/u);
  assert.match(enable, /inspection\.path !== '\.github\/workflows\/clerk-webhook-event-production-inspection\.yml'/u);
  assert.match(enable, /inspection\.display_title !== `ClerkWebhookEvent Production Inspection \[activation-compatible\] \$\{sha\}`/u);
  assert.match(enable, /inspection\.head_sha !== sha/u);
  assert.match(enable, /inspection\.run_attempt !== 1/u);
  assert.match(enable, /inspection\.conclusion !== 'success'/u);
  assert.match(enable, /group: production-database-migrations/u);
  assert.match(enable, /environment: Production/u);
  assert.match(enable, /guard-production-migration-runner\.mjs/u);
  assert.match(enable, /CLERK_WEBHOOK_EVENT_EXPECTED_STATE: activation-compatible/u);
  assert.match(enable, /CLERK_WEBHOOK_EVENT_EXPECTED_STATE: enabled/u);
  assert.match(enable, /steps\.preflight\.outputs\.state == 'complete'/u);
  assert.equal((enable.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((enable.match(/npx prisma migrate status/gu) ?? []).length, 2);
  assert.equal((enable.match(/assert-reviewed-pending-migrations\.mjs/gu) ?? []).length, 2);
  assert.match(enable, /for path in prisma\/migrations\/\*\/; do[\s\S]*if \[\[ "\$candidate" > "\$migration" \]\]/u);
  assert.match(enable, /mv "prisma\/migrations\/\$migration" "\$holding\/\$migration"[\s\S]*npx prisma migrate status[\s\S]*mv "\$holding\/\$migration" "prisma\/migrations\/\$migration"[\s\S]*npx prisma migrate deploy/u);
  assert.match(enable, /trap restore EXIT/u);
  assert.match(enable, /npm run audit:db-grants -- --require-direct-url/u);
  assert.match(enable, new RegExp(`${activationDigest}  ${activationPath.replaceAll(".", "\\.")}`, "u"));
  assert.doesNotMatch(enable, /FORCE ROW LEVEL SECURITY|vercel|git push/iu);
});

test("ENABLE proves source before owner access and inspect-status-apply-postflight-audit in order", () => {
  const source = enable.indexOf("Verify ClerkWebhookEvent policyless ENABLE release source");
  const bytes = enable.indexOf("Verify exact ClerkWebhookEvent ENABLE migration bytes");
  const boundary = enable.indexOf("Verify owner connection boundary");
  const preflight = enable.indexOf("Inspect restart-safe ClerkWebhookEvent state before apply");
  const apply = enable.indexOf("Apply only reviewed ClerkWebhookEvent ENABLE migration");
  const postflight = enable.indexOf("Inspect enabled ClerkWebhookEvent catalog after apply");
  const audit = enable.indexOf("Audit global grants after ClerkWebhookEvent ENABLE");
  assert.ok(source >= 0 && source < bytes && bytes < boundary && boundary < preflight);
  assert.ok(preflight < apply && apply < postflight && postflight < audit);
});

test("inspection proves exact source and bytes before touching the owner connection", () => {
  const source = inspection.indexOf("Verify read-only ClerkWebhookEvent inspection source");
  const bytes = inspection.indexOf("Verify exact ClerkWebhookEvent migration bytes");
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
  assert.equal((release.match(/assert-reviewed-pending-migrations\.mjs/gu) ?? []).length, 2);
  assert.match(release, /for path in prisma\/migrations\/\*\/; do[\s\S]*if \[\[ "\$candidate" > "\$migration" \]\]/u);
  assert.match(release, /mv "prisma\/migrations\/\$migration" "\$holding\/\$migration"[\s\S]*npx prisma migrate status[\s\S]*mv "\$holding\/\$migration" "prisma\/migrations\/\$migration"[\s\S]*npx prisma migrate deploy/u);
  assert.match(release, /trap restore EXIT/u);
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
  const apply = release.indexOf("Apply only reviewed ClerkWebhookEvent compatibility migration");
  const audit = release.indexOf("Audit global grants after ClerkWebhookEvent compatibility release");
  const postflight = release.indexOf("Inspect complete ClerkWebhookEvent catalog after apply");
  assert.ok(source >= 0 && source < bytes && bytes < boundary && boundary < preflight);
  assert.ok(preflight < apply && apply < audit && audit < postflight);
});

test("current-main Clerk workflows do not require their migration to be newest", () => {
  for (const workflow of [inspection, release, enable, force]) {
    const bytesStart = workflow.indexOf("Verify exact");
    const boundary = workflow.indexOf("Verify owner connection boundary");
    assert.ok(bytesStart >= 0 && boundary > bytesStart);
    assert.doesNotMatch(workflow.slice(bytesStart, boundary), /tail -n 1/u);
  }
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
  assert.match(
    replay,
    /listing_holding="\$RUNNER_TEMP\/listing-hide-delete\/\$listing_migration\/migration\.sql"[\s\S]*cp "\$listing_holding" "\$listing_candidate\/migration\.sql"[\s\S]*trap cleanup_listing_source EXIT[\s\S]*node --test[\s\S]*cleanup_listing_source[\s\S]*trap - EXIT/u,
  );
});
