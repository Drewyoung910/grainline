import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationDirectory =
  process.env.USER_REPORT_PREPARATION_MIGRATION_PATH ??
  "prisma/migrations/20261028060000_prepare_user_report_authorities";
const migration = readFileSync(`${migrationDirectory}/migration.sql`, "utf8");
const adminPage = readFileSync("src/app/admin/reports/page.tsx", "utf8");
const resolveRoute = readFileSync(
  "src/app/api/admin/reports/[id]/resolve/route.ts",
  "utf8",
);
const resolveControl = readFileSync(
  "src/components/admin/ResolveReportButton.tsx",
  "utf8",
);
const accountExport = readFileSync("src/app/api/account/export/route.ts", "utf8");
const accountDeletion = readFileSync("src/lib/accountDeletion.ts", "utf8");

test("UserReport preparation remains additive and leaves RLS and table grants unchanged", () => {
  assert.match(migration, /ADD COLUMN "internalResolutionNote" varchar\(1000\)/u);
  assert.doesNotMatch(migration, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/iu);
  assert.doesNotMatch(migration, /FORCE\s+ROW\s+LEVEL\s+SECURITY/iu);
  assert.doesNotMatch(migration, /REVOKE[\s\S]{0,300}ON\s+TABLE/iu);
  assert.doesNotMatch(migration, /DROP\s+(?:COLUMN|TABLE)/iu);
});

test("UserReport operations are split between actor-bound runtime and isolated staff authorities", () => {
  const functionNames = [...migration.matchAll(/CREATE FUNCTION public\.(grainline_user_report_[a-z_]+)\(/gu)]
    .map((match) => match[1]);
  assert.equal(functionNames.length, 8);
  assert.equal(new Set(functionNames).size, 8);
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.equal((migration.match(/SESSION_USER <> 'grainline_staff_read_runtime'/gu) ?? []).length, 4);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_user_report_staff_resolve[\s\S]*TO grainline_staff_read_runtime/u);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.grainline_user_report_submit[\s\S]*TO grainline_app_runtime/u);
});

test("all UserReport callers use fixed authorities and the staff queue is complete", () => {
  assert.doesNotMatch(adminPage, /prisma\.userReport\./u);
  assert.doesNotMatch(resolveRoute, /prisma\.userReport\./u);
  assert.doesNotMatch(accountExport, /prisma\.userReport\./u);
  assert.doesNotMatch(accountDeletion, /userReport\.updateMany/u);
  assert.match(adminPage, /userReportStaffOpenCount/u);
  assert.match(adminPage, /userReportStaffOpenPage/u);
  assert.match(adminPage, /Oldest unresolved reports are shown first/u);
  assert.match(adminPage, /afterCreatedAt/u);
});

test("participant-visible rationale and private staff notes stay separate", () => {
  const submittedExport = migration.slice(
    migration.indexOf("CREATE FUNCTION public.grainline_user_report_owner_submitted_export"),
    migration.indexOf("CREATE FUNCTION public.grainline_user_report_owner_received_export"),
  );
  const receivedExport = migration.slice(
    migration.indexOf("CREATE FUNCTION public.grainline_user_report_owner_received_export"),
    migration.indexOf("CREATE FUNCTION public.grainline_user_report_staff_open_count"),
  );
  assert.match(resolveRoute, /participantRationale/u);
  assert.match(resolveRoute, /internalNote/u);
  assert.match(resolveControl, /shown to both people/u);
  assert.match(resolveControl, /must not appear in participant exports/u);
  assert.match(migration, /"resolutionNote" = normalized_rationale/u);
  assert.match(migration, /"internalResolutionNote" = normalized_internal_note/u);
  assert.doesNotMatch(submittedExport, /internalResolutionNote/u);
  assert.doesNotMatch(receivedExport, /internalResolutionNote/u);
});

test("account deletion is claim-bound before report redaction", () => {
  assert.match(migration, /grainline_account_deletion_claim_user\(/u);
  assert.match(migration, /actor_id IS DISTINCT FROM claimed_user_id/u);
  assert.match(accountDeletion, /redactUserReportsForAccountDeletion\(tx, \{/u);
  assert.match(accountDeletion, /sideEffectId: localAnonymizeSideEffectId/u);
  assert.match(accountDeletion, /claimGeneration: localClaimGeneration/u);
  assert.match(accountDeletion, /claimToken: localClaimToken/u);
});
