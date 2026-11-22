import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname);
const sourceRoot = resolve(root, "src");
const operations = [
  "count",
  "create",
  "delete",
  "deleteMany",
  "findFirst",
  "findMany",
  "findUnique",
  "update",
  "updateMany",
];

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolute = resolve(directory, entry);
    if (statSync(absolute).isDirectory()) files.push(...sourceFiles(absolute));
    else if (/\.(?:ts|tsx)$/u.test(entry)) files.push(absolute);
  }
  return files;
}

test("Commission application source has zero direct base-table access", () => {
  const delegatePattern = new RegExp(
    `\\bcommission(?:Request|Interest)\\s*\\.\\s*(?:${operations.join("|")})\\s*\\(`,
    "gu",
  );
  const rawSqlPattern =
    /\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+(?:public\.)?"Commission(?:Request|Interest)"/giu;
  const direct = [];
  for (const absolute of sourceFiles(sourceRoot)) {
    const source = readFileSync(absolute, "utf8");
    if (delegatePattern.test(source) || rawSqlPattern.test(source)) {
      direct.push(relative(root, absolute).replaceAll("\\", "/"));
    }
    delegatePattern.lastIndex = 0;
    rawSqlPattern.lastIndex = 0;
  }
  assert.deepEqual(direct.sort(), []);
});

test("Commission ban restoration uses a separate snapshot-bound capability", () => {
  const access = readFileSync(resolve(root, "src/lib/commissionRequestAccess.ts"), "utf8");
  const migration = readFileSync(
    resolve(
      root,
      "prisma/migrations/20261113010000_prepare_commission_domain_authorities/migration.sql",
    ),
    "utf8",
  );
  assert.match(
    access,
    /grainline_order_staff_capability_mint\([\s\S]*'BAN_REVIEW_RESTORE'::text[\s\S]*JSON\.stringify\(payload\)/u,
  );
  assert.match(
    migration,
    /snapshot_hash :=[\s\S]*DELETE FROM public\."OrderStaffCapability"[\s\S]*"payloadHash" = snapshot_hash/u,
  );
  assert.doesNotMatch(
    migration,
    /pg_catalog\.coalesce/u,
    "COALESCE is SQL syntax, not a pg_catalog function",
  );
  assert.match(
    migration,
    /target\.id = p_target_user_id\s+AND target\.banned = false/u,
  );
  assert.match(
    migration,
    /ORDER BY source\.ordinality/u,
  );
  assert.match(migration, /WITH ORDINALITY AS source\(id, status, ordinality\)/u);
});

test("Commission preparation refuses legacy rows that would break owner/export flows", () => {
  const migration = readFileSync(
    resolve(
      root,
      "prisma/migrations/20261113010000_prepare_commission_domain_authorities/migration.sql",
    ),
    "utf8",
  );
  assert.match(
    migration,
    /CommissionRequest historical row violates the converted owner\/export contract/u,
  );
  assert.match(
    migration,
    /pg_catalog\.cardinality\(request\."referenceImageUrls"\) > 3/u,
  );
  assert.match(migration, /request\.lat::text IN \('NaN', 'Infinity', '-Infinity'\)/u);
});

test("Commission activation plan retires superseded identity-taking authorities", () => {
  const options = readFileSync(resolve(root, "docs/commission-rls-options.md"), "utf8");
  for (const identity of [
    "grainline_message_create_commission_interest(text,text,text,text,text)",
    "grainline_direct_upload_sync_commission_request(text,text)",
    "grainline_seller_service_commission_interest_targets(text,integer)",
  ]) {
    assert.match(options, new RegExp(identity.replace(/[()]/gu, "\\$&"), "u"));
  }
  assert.match(options, /activation must revoke runtime `EXECUTE`/u);
});
