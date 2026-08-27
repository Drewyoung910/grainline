import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  ".github/workflows/blocked-checkout-transfer-binding-production.yml",
  "utf8",
);
const generic = readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("dedicated workflow binds one protected exact-main operation", () => {
  assert.match(
    workflow,
    /^name: Blocked Checkout Transfer Binding Production Compatibility$/m,
  );
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /releaseCommit !== context\.sha/);
  assert.match(workflow, /run\.head_sha !== releaseCommit/);
  assert.match(workflow, /run\.head_branch !== 'main'/);
  assert.match(workflow, /run\.name !== 'CI'/);
  assert.match(workflow, /run\.event !== 'push'/);
  assert.match(workflow, /run\.conclusion !== 'success'/);
  assert.match(
    workflow,
    /apply-reviewed-blocked-checkout-transfer-binding-compatibility/,
  );
  assert.match(workflow, /persist-credentials: false/);
});

test("dedicated workflow admits only the byte-pinned restart-safe candidate", () => {
  assert.match(
    workflow,
    /latest[\s\S]*20260826010000_prepare_blocked_checkout_transfer_binding/,
  );
  assert.match(
    workflow,
    /audit:order-payment-blocked-checkout-transfer-binding-release/,
  );
  assert.match(
    workflow,
    /BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGE: restart/,
  );
  assert.match(
    workflow,
    /"transfer-binding-predecessor", "transfer-binding-compatible"/,
  );
  assert.match(
    workflow,
    /if: steps\.scope\.outputs\.state == 'transfer-binding-predecessor'[\s\S]*npx prisma migrate deploy/,
  );
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(
    workflow,
    /BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGE: after/,
  );
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/);
  assert.doesNotMatch(
    workflow,
    /vercel|stripe\.com|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu,
  );
});

test("generic production runner cannot apply an unreviewed transfer binding", () => {
  const inspect = generic.indexOf(
    "Inspect blocked-checkout transfer binding restart scope read-only",
  );
  const isolate = generic.indexOf(
    "Isolate unapplied blocked-checkout transfer binding compatibility",
  );
  const deploy = generic.indexOf("- name: Apply production migrations");
  const status = generic.indexOf("- name: Verify production migration status");
  const restore = generic.indexOf(
    "Restore unapplied blocked-checkout transfer binding compatibility",
  );
  const reverify = generic.indexOf(
    "Reverify blocked-checkout transfer binding restart scope read-only",
  );
  assert.ok(inspect >= 0 && inspect < isolate);
  assert.ok(isolate < deploy && deploy < status && status < restore);
  assert.ok(restore < reverify);
  assert.match(
    generic,
    /if: steps\.transfer_scope\.outputs\.state == 'transfer-binding-predecessor'/,
  );
  assert.match(
    generic,
    /BLOCKED_CHECKOUT_TRANSFER_BINDING_SCOPE_STAGE: restart/,
  );
});

test("package exposes the exact production scope verifier", () => {
  assert.equal(
    pkg.scripts?.[
      "audit:order-payment-blocked-checkout-transfer-binding-production-scope"
    ],
    "node scripts/verify-blocked-checkout-transfer-binding-production-scope.mjs",
  );
});
