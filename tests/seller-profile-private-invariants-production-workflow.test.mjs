import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/seller-profile-private-invariants-production.yml",
  "utf8",
);
const inspector = readFileSync(
  "scripts/seller-profile-private-invariants-production-inspect.mjs",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const migration = "20261015080000_restore_seller_profile_private_invariants";
const checksum = "983c4a52e5390819f7608dd1245c19ce60b4708e85c062f0e9df3556e71ca0ed";

function ciStep(name) {
  const start = ci.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, name);
  const next = ci.indexOf("\n      - ", start + 1);
  return ci.slice(start, next < 0 ? undefined : next);
}

test("SellerProfile invariant workflow parses and is exact-main Production-bound", () => {
  const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /environment: Production/u);
  assert.match(workflow, /main\.commit\.sha !== sha/u);
  assert.match(workflow, /run\.head_sha !== sha/u);
  assert.match(workflow, /run\.conclusion !== 'success'/u);
});

test("workflow admits one immutable restart-safe invariant migration", () => {
  assert.match(workflow, new RegExp(migration, "u"));
  assert.match(
    workflow,
    new RegExp(`${checksum}  prisma/migrations/\\$migration/migration\\.sql`, "u"),
  );
  assert.match(workflow, /compatible-or-repaired/u);
  assert.match(workflow, /Require only the reviewed invariant restoration pending[\s\S]*assert-reviewed-pending-migrations\.mjs/u);
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.equal((workflow.match(/npx prisma migrate status/gu) ?? []).length, 1);
  assert.match(workflow, /steps\.preflight\.outputs\.state == 'compatible'/u);
});

test("sanitized inspector pins prerequisites, invariants, ACLs, and unchanged pre-RLS posture", () => {
  assert.match(inspector, /20261015010000_retire_seller_profile_private_predecessor/u);
  assert.match(inspector, /20261015013000_repair_account_deletion_after_seller_profile_retirement/u);
  assert.match(inspector, /SellerProfilePrivate_shipFromPhone_e164_check/u);
  assert.match(inspector, /SellerProfilePrivate_supported_snapshot_sync/u);
  assert.match(inspector, /SellerProfile_supported_snapshot_guard/u);
  assert.match(inspector, /snapshot_mismatch_count/u);
  assert.match(inspector, /invalid_phone_count/u);
  assert.match(inspector, /missing_private_count/u);
  assert.match(inspector, /runtime_private_any: false/u);
  assert.match(inspector, /private_rls: false/u);
  assert.match(inspector, /containsRowData: false/u);
  assert.doesNotMatch(inspector, /SELECT\s+\*/iu);
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu);
});

test("CI isolates, restores, applies, and replays current-schema SellerProfile proofs in order", () => {
  const verify = "Verify SellerProfile private-boundary source package";
  const isolate = "Isolate SellerProfile private-boundary migration from historical release guards";
  const restore = "Restore SellerProfile private-boundary migration after all predecessors";
  const repair = "Apply account-deletion post-retirement repair in disposable PostgreSQL";
  const apply = "Apply SellerProfile private invariant restoration in disposable PostgreSQL";
  const replay = "Re-prove SellerProfile-touching fixtures on the restored current schema";
  assert.ok(ci.indexOf(verify) < ci.indexOf(isolate));
  assert.ok(ci.indexOf(isolate) < ci.indexOf(restore));
  assert.ok(ci.indexOf(restore) < ci.indexOf(repair));
  assert.ok(ci.indexOf(repair) < ci.indexOf(apply));
  assert.ok(ci.indexOf(apply) < ci.indexOf(replay));
  assert.ok(ciStep(isolate).includes(migration));
  assert.ok(ciStep(restore).includes(migration));
  assert.match(ciStep(replay), /audit:rls-case-seller-aggregate/u);
  assert.match(ciStep(replay), /audit:rls-case-invariant-drafts/u);
  assert.match(ciStep(replay), /audit:rls-conversation-message-recipient/u);
  assert.match(ciStep(replay), /audit:rls-notification-ephemeral/u);
  assert.match(ciStep(replay), /audit:rls-seller-payout-event-activation-postgres/u);
  assert.match(
    ciStep(replay),
    /ALTER ROLE grainline_app_runtime PASSWORD 'grainline-ci-runtime-postflight-only'/u,
  );
  assert.ok(
    ciStep(replay).indexOf("ALTER ROLE grainline_app_runtime PASSWORD")
      < ciStep(replay).indexOf("audit:rls-seller-payout-event-activation-postgres"),
  );
  assert.match(
    ciStep(replay),
    /SELLER_PAYOUT_EVENT_CURRENT_SCHEMA_REPLAY: "true"/u,
  );
});
