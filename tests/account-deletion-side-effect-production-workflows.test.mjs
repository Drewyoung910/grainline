import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const inspection = readFileSync(
  ".github/workflows/account-deletion-side-effect-production-inspection.yml",
  "utf8",
);
const preparation = readFileSync(
  ".github/workflows/account-deletion-side-effect-preparation-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const preparationPath =
  "prisma/migrations/20261011170000_prepare_account_deletion_side_effect_claim_fence/migration.sql";
const activationPath =
  "prisma/migrations/20261011180000_enable_account_deletion_side_effect_rls/migration.sql";
const mediaKeyPath =
  "prisma/migrations/20261011173000_prepare_account_deletion_media_key_fence/migration.sql";
const preparationDigest = createHash("sha256")
  .update(readFileSync(preparationPath))
  .digest("hex");
const activationDigest = createHash("sha256")
  .update(readFileSync(activationPath))
  .digest("hex");
const mediaKeyDigest = createHash("sha256")
  .update(readFileSync(mediaKeyPath))
  .digest("hex");

test("inspection is exact-main, exact-CI, first-attempt, manual, and read-only", () => {
  assert.match(
    inspection,
    /name: AccountDeletionSideEffect Production Inspection/u,
  );
  assert.match(
    inspection,
    /run-name: AccountDeletionSideEffect Production Inspection \[\$\{\{ inputs\.expected_state \}\}\] \$\{\{ inputs\.release_commit \}\}/u,
  );
  assert.match(inspection, /workflow_dispatch:/u);
  assert.match(
    inspection,
    /inputs\.confirmation == 'inspect-reviewed-account-deletion-side-effect-preparation'/u,
  );
  assert.match(inspection, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(inspection, /github\.run_attempt == 1/u);
  assert.match(inspection, /main\.commit\.sha !== sha/u);
  assert.match(inspection, /run\.name !== 'CI'/u);
  assert.match(inspection, /run\.head_sha !== sha/u);
  assert.match(inspection, /run\.conclusion !== 'success'/u);
  assert.match(inspection, /group: production-database-inspections/u);
  assert.match(inspection, /environment: Production/u);
  assert.match(inspection, /guard-production-migration-runner\.mjs/u);
  assert.match(
    inspection,
    /account-deletion-side-effect-production-inspect\.mjs/u,
  );
  assert.match(
    inspection,
    /ACCOUNT_DELETION_EXPECTED_STATE: \$\{\{ inputs\.expected_state \}\}/u,
  );
  assert.match(
    inspection,
    /name: Preserve sanitized AccountDeletionSideEffect catalog evidence\n\s+if: always\(\)/u,
  );
  assert.match(
    inspection,
    new RegExp(
      `${preparationDigest}  ${preparationPath.replaceAll(".", "\\.")}`,
      "u",
    ),
  );
  assert.match(
    inspection,
    new RegExp(
      `${mediaKeyDigest}  ${mediaKeyPath.replaceAll(".", "\\.")}`,
      "u",
    ),
  );
  assert.match(
    inspection,
    new RegExp(
      `${activationDigest}  ${activationPath.replaceAll(".", "\\.")}`,
      "u",
    ),
  );
  assert.doesNotMatch(
    inspection,
    /prisma migrate deploy|ALTER TABLE|vercel|git push/iu,
  );
});

test("inspection proves source and bytes before owner access", () => {
  const source = inspection.indexOf(
    "Verify read-only AccountDeletionSideEffect inspection source",
  );
  const bytes = inspection.indexOf(
    "Verify exact AccountDeletionSideEffect migration bytes",
  );
  const boundary = inspection.indexOf("Verify owner connection boundary");
  const inspect = inspection.indexOf(
    "Inspect AccountDeletionSideEffect preparation catalog read-only",
  );
  assert.ok(
    source >= 0 && source < bytes && bytes < boundary && boundary < inspect,
  );
  for (const file of [
    "tests/account-deletion-side-effect-production-inspect.test.mjs",
    "tests/account-deletion-side-effect-production-workflows.test.mjs",
    "tests/account-deletion-side-effect-database-contract.test.mjs",
  ])
    assert.match(inspection, new RegExp(file.replaceAll(".", "\\."), "u"));
});

test("inspection owner guard receives the exact reviewed release binding", () => {
  const guard = inspection.slice(
    inspection.indexOf("- name: Verify owner connection boundary"),
    inspection.indexOf(
      "- name: Inspect AccountDeletionSideEffect preparation catalog read-only",
    ),
  );
  assert.match(
    guard,
    /PRODUCTION_MIGRATION_CONFIRM: run-reviewed-production-migrations-from-main/u,
  );
  assert.match(
    guard,
    /PRODUCTION_MIGRATION_RELEASE_COMMIT: \$\{\{ inputs\.release_commit \}\}/u,
  );
  assert.match(
    guard,
    /DIRECT_URL: \$\{\{ secrets\.PRODUCTION_MIGRATION_DIRECT_URL \}\}/u,
  );
});

test("preparation is inspection-bound, exact-main, scope-closed, restart-safe, and activation-isolated", () => {
  assert.match(
    preparation,
    /name: AccountDeletionSideEffect Preparation Production/u,
  );
  assert.match(
    preparation,
    /inputs\.confirmation == 'apply-reviewed-account-deletion-side-effect-preparation'/u,
  );
  assert.match(preparation, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(preparation, /github\.run_attempt == 1/u);
  assert.match(preparation, /main\.commit\.sha !== sha/u);
  assert.match(preparation, /ci\.head_sha !== sha/u);
  assert.match(
    preparation,
    /inspection\.path !== '\.github\/workflows\/account-deletion-side-effect-production-inspection\.yml'/u,
  );
  assert.match(
    preparation,
    /inspection\.display_title !== `AccountDeletionSideEffect Production Inspection \[compatible\] \$\{sha\}`/u,
  );
  assert.match(preparation, /inspection\.head_sha !== sha/u);
  assert.match(preparation, /inspection\.run_attempt !== 1/u);
  assert.match(preparation, /inspection\.conclusion !== 'success'/u);
  assert.match(preparation, /group: production-database-migrations/u);
  assert.match(preparation, /environment: Production/u);
  assert.match(preparation, /ACCOUNT_DELETION_EXPECTED_STATE: compatible/u);
  assert.match(preparation, /ACCOUNT_DELETION_EXPECTED_STATE: prepared/u);
  assert.match(preparation, /steps\.preflight\.outputs\.state != 'prepared'/u);
  assert.match(preparation, /pending\|preparation_only\|prepared/u);
  assert.match(
    preparation,
    /ACCOUNT_DELETION_PREFLIGHT_STATE: \$\{\{ steps\.preflight\.outputs\.state \}\}/u,
  );
  assert.match(
    preparation,
    /if \[\[ "\$ACCOUNT_DELETION_PREFLIGHT_STATE" == "pending" \]\]/u,
  );
  assert.match(
    preparation,
    /if \[\[ "\$ACCOUNT_DELETION_PREFLIGHT_STATE" == "preparation_only" \]\][\s\S]*elif \[\[ "\$ACCOUNT_DELETION_PREFLIGHT_STATE" != "pending" \]\]/u,
  );
  assert.equal(
    (preparation.match(/npx prisma migrate deploy/gu) ?? []).length,
    1,
  );
  assert.equal(
    (preparation.match(/npx prisma migrate status/gu) ?? []).length,
    2,
  );
  assert.match(
    preparation,
    /mv "prisma\/migrations\/\$activation" "\$holding\/\$activation"/u,
  );
  assert.match(preparation, /trap restore EXIT/u);
  assert.match(preparation, /npm run audit:db-grants -- --require-direct-url/u);
  assert.match(
    preparation,
    new RegExp(
      `${preparationDigest}  ${preparationPath.replaceAll(".", "\\.")}`,
      "u",
    ),
  );
  assert.match(
    preparation,
    new RegExp(
      `${mediaKeyDigest}  ${mediaKeyPath.replaceAll(".", "\\.")}`,
      "u",
    ),
  );
  assert.match(
    preparation,
    new RegExp(
      `${activationDigest}  ${activationPath.replaceAll(".", "\\.")}`,
      "u",
    ),
  );
  assert.doesNotMatch(
    preparation,
    /ALTER TABLE|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|vercel|git push/iu,
  );
});

test("preparation performs source proof before owner access and inspect-isolate-apply-postflight-audit in order", () => {
  const source = preparation.indexOf(
    "Verify AccountDeletionSideEffect preparation release source",
  );
  const bytes = preparation.indexOf(
    "Verify exact AccountDeletionSideEffect preparation bytes",
  );
  const boundary = preparation.indexOf("Verify owner connection boundary");
  const preflight = preparation.indexOf(
    "Inspect restart-safe AccountDeletionSideEffect state before apply",
  );
  const apply = preparation.indexOf(
    "Apply only reviewed AccountDeletionSideEffect preparation migration",
  );
  const postflight = preparation.indexOf(
    "Inspect prepared AccountDeletionSideEffect catalog after apply",
  );
  const audit = preparation.indexOf(
    "Audit global grants after AccountDeletionSideEffect preparation",
  );
  assert.ok(
    source >= 0 && source < bytes && bytes < boundary && boundary < preflight,
  );
  assert.ok(preflight < apply && apply < postflight && postflight < audit);
});

test("historical CI isolates the new preparation wiring tests and replays them after restore", () => {
  for (const file of [
    "tests/account-deletion-side-effect-production-inspect.test.mjs",
    "tests/account-deletion-side-effect-production-workflows.test.mjs",
  ])
    assert.equal(ci.split(file).length - 1, 3, file);
  const verify = ci.indexOf(
    "Verify AccountDeletionSideEffect claim-fence source package",
  );
  const isolate = ci.indexOf(
    "Isolate AccountDeletionSideEffect claim-fence until its predecessors pass",
  );
  const broad = ci.indexOf("      - name: Tests\n");
  const restore = ci.indexOf(
    "Restore AccountDeletionSideEffect claim-fence source package",
  );
  const replay = ci.slice(
    ci.indexOf(
      "Re-verify AccountDeletionSideEffect claim-fence source package",
    ),
    ci.indexOf(
      "Apply AccountDeletionSideEffect claim-fence preparation in disposable PostgreSQL",
    ),
  );
  assert.ok(
    verify >= 0 && verify < isolate && isolate < broad && restore > broad,
  );
  assert.match(
    replay,
    /account-deletion-side-effect-production-inspect\.test\.mjs/u,
  );
  assert.match(
    replay,
    /account-deletion-side-effect-production-workflows\.test\.mjs/u,
  );
});
