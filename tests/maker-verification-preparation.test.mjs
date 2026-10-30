import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationPath = process.env.MAKER_VERIFICATION_PREPARATION_MIGRATION_PATH?.trim()
  || "prisma/migrations/20261028040000_prepare_maker_verification_authorities/migration.sql";
const fullChainTestPath = process.env.DATABASE_FULL_CHAIN_POSTGRES_TEST_PATH?.trim()
  || "tests/database-full-chain-postgres.test.mjs";

function source(path) {
  return readFileSync(path, "utf8");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

function functionBody(sql, name) {
  const marker = `CREATE FUNCTION public.${name}(`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = sql.indexOf("\nCREATE FUNCTION public.", start + marker.length);
  return sql.slice(start, next === -1 ? sql.length : next);
}

test("MakerVerification preparation remains additive and preserves predecessor grants", () => {
  const sql = source(migrationPath);
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.doesNotMatch(sql, /ALTER TABLE public\."MakerVerification" (?:ENABLE|FORCE) ROW LEVEL SECURITY/u);
  assert.doesNotMatch(sql, /REVOKE [^;]* ON (?:TABLE )?public\."MakerVerification"/u);
  assert.match(sql, /MakerVerification RLS and predecessor table[\s\S]*grants remain unchanged/u);
});

test("MakerVerification preparation installs the exact purpose-bound surface", () => {
  const sql = source(migrationPath);
  const expected = [
    "grainline_seller_guild_staff_transition",
    "grainline_seller_guild_member_revoke",
    "grainline_seller_guild_metrics_apply",
    "grainline_maker_verification_owner_member_apply",
    "grainline_maker_verification_owner_master_apply",
    "grainline_maker_verification_owner_export",
    "grainline_maker_verification_owner_delete_redact",
    "grainline_maker_verification_staff_pending_count",
    "grainline_maker_verification_staff_pending_page",
    "grainline_seller_guild_staff_master_pending_count",
    "grainline_seller_guild_staff_master_pending_page",
    "grainline_seller_guild_staff_roster_count",
    "grainline_seller_guild_staff_roster_page",
  ];
  const created = [...sql.matchAll(/CREATE FUNCTION public\.([a-z0-9_]+)\(/gu)]
    .map((match) => match[1]);
  assert.deepEqual(created, expected);

  for (const name of expected) {
    const body = functionBody(sql, name);
    assert.match(body, /SECURITY DEFINER/u, `${name} must be SECURITY DEFINER`);
    assert.match(body, /SET search_path = pg_catalog/u, `${name} must pin search_path`);
  }

  for (const name of [
    "grainline_seller_guild_staff_transition_prepared_impl",
    "grainline_seller_guild_member_revoke_prepared_impl",
    "grainline_seller_guild_metrics_apply_prepared_impl",
  ]) {
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;`, "u"),
    );
    assert.doesNotMatch(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`, "u"));
  }
  for (const digest of [
    "5cc52746e1be3955628192bf32364d7f",
    "5511d57e540b8051a22e51e06ce5d528",
    "09f24202b6869178b14f23782c6cbc2c",
  ]) {
    assert.equal(sql.split(digest).length - 1, 2, `${digest} must be pinned before and after rename`);
  }
});

test("MakerVerification owner and lifecycle operations share canonical lock order", () => {
  const sql = source(migrationPath);
  for (const name of [
    "grainline_maker_verification_owner_member_apply",
    "grainline_maker_verification_owner_master_apply",
  ]) {
    const body = functionBody(sql, name);
    const user = body.indexOf('FROM public."User"');
    const seller = body.indexOf('FROM public."SellerProfile"');
    const verification = body.indexOf('FROM public."MakerVerification"');
    assert.ok(user >= 0 && user < seller && seller < verification, `${name} lock order drifted`);
  }

  for (const name of [
    "grainline_seller_guild_staff_transition",
    "grainline_seller_guild_member_revoke",
    "grainline_seller_guild_metrics_apply",
  ]) {
    const body = functionBody(sql, name);
    const seller = body.search(/PERFORM 1\s+FROM public\."SellerProfile"/u);
    const verification = body.search(/PERFORM 1\s+FROM public\."MakerVerification"/u);
    const sellerPrivate = body.search(/PERFORM 1\s+FROM public\."SellerProfilePrivate"/u);
    assert.ok(
      seller >= 0 && seller < verification && verification < sellerPrivate,
      `${name} canonical seller lock order drifted`,
    );
  }
});

test("MakerVerification app callers use fixed operations and preserve input intent", () => {
  const allSource = sourceFiles("src").map((path) => source(path)).join("\n");
  assert.doesNotMatch(
    allSource,
    /\.makerVerification\.(?:findUnique|findFirst|findMany|count|aggregate|create|createMany|upsert|update|updateMany|delete|deleteMany)\b/u,
  );

  const access = source("src/lib/makerVerificationAccess.ts");
  for (const functionName of [
    "grainline_maker_verification_owner_member_apply",
    "grainline_maker_verification_owner_master_apply",
    "grainline_maker_verification_owner_export",
    "grainline_maker_verification_owner_delete_redact",
    "grainline_maker_verification_staff_pending_count",
    "grainline_maker_verification_staff_pending_page",
  ]) assert.match(access, new RegExp(functionName, "u"));

  const staffAccess = source("src/lib/sellerGuildStaffPrivateAccess.ts");
  for (const functionName of [
    "grainline_seller_guild_staff_master_pending_count",
    "grainline_seller_guild_staff_master_pending_page",
    "grainline_seller_guild_staff_roster_count",
    "grainline_seller_guild_staff_roster_page",
  ]) assert.match(staffAccess, new RegExp(functionName, "u"));

  const route = source("src/app/api/verification/apply/route.ts");
  assert.match(route, /confirmHandmade: z\.literal\(true\)/u);
  assert.match(route, /const craftDescription = truncateText\(sanitizeText\(/u);
  assert.match(route, /if \(!craftDescription\)/u);
  assert.match(route, /confirmedHandmade: verParsed\.confirmHandmade/u);

  const masterApply = functionBody(
    source(migrationPath),
    "grainline_maker_verification_owner_master_apply",
  );
  assert.doesNotMatch(masterApply, /"reviewedById" = NULL/u);
  assert.doesNotMatch(masterApply, /"reviewNotes" = NULL/u);
  assert.doesNotMatch(masterApply, /"reviewedAt" = NULL/u);
});

test("MakerVerification complete-schema proof is wired into the full-chain job", () => {
  const fullChain = source(fullChainTestPath);
  assert.match(fullChain, /import \{ proveMakerVerificationPreparedAuthorities \}/u);
  assert.match(fullChain, /await proveMakerVerificationPreparedAuthorities\(\{/u);
  assert.match(fullChain, /connectionString: proofDatabaseUrl/u);

  const scenario = source("tools/database-full-chain/scenarios/maker-verification-authorities.mjs");
  assert.match(scenario, /async function expectSqlState/u);
  assert.match(scenario, /async function proveOwnerInputAndActorDenials/u);
  assert.match(scenario, /async function proveOwnerStaffLockOrder/u);
  assert.match(scenario, /async function proveOwnerCronLockOrder/u);
  assert.match(scenario, /async function proveStaffPagination/u);
  assert.match(scenario, /async function proveStaffTransitionMatrix/u);
  assert.match(scenario, /async function proveServiceTransitionMatrix/u);
  assert.match(scenario, /pg_catalog\.generate_series\(1, 55\)/u);
  assert.match(scenario, /await proveOwnerStaffLockOrder\(\{/u);
  assert.match(scenario, /await proveOwnerCronLockOrder\(\{/u);
  assert.match(scenario, /await proveStaffPagination\(\{/u);
  assert.match(scenario, /await proveStaffTransitionMatrix\(\{/u);
  assert.match(scenario, /await proveServiceTransitionMatrix\(\{/u);
  assert.match(scenario, /await proveOwnerInputAndActorDenials\(\{/u);
  for (const operation of [
    "APPROVE_GUILD_MEMBER",
    "REJECT_GUILD_MEMBER",
    "REVOKE_GUILD_MEMBER",
    "APPROVE_GUILD_MASTER",
    "REJECT_GUILD_MASTER",
    "REVOKE_GUILD_MASTER",
    "REINSTATE_GUILD_MEMBER",
  ]) assert.match(scenario, new RegExp(`\\[\"[^\"]+\", \"${operation}\"`, "u"));
  assert.match(
    scenario,
    /\["revoke_member_pending_master", "REVOKE_GUILD_MEMBER", false\]/u,
  );
  assert.match(
    scenario,
    /revoke_member_pending_master: \["REJECTED", "NONE"\]/u,
  );
  assert.match(scenario, /Promise\.all/u);
  assert.match(scenario, /grainline_seller_guild_staff_transition_prepared_impl/u);
  assert.match(scenario, /grainline_seller_guild_member_revoke_prepared_impl/u);
  assert.match(scenario, /grainline_seller_guild_metrics_apply_prepared_impl/u);
});
