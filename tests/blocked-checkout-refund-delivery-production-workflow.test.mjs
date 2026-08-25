import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  verifyOrderPaymentSignedAuthorityRelease,
} from "../scripts/verify-order-payment-signed-authority-release.mjs";
import {
  verifyOrderRefundClaimGenerationRelease,
} from "../scripts/verify-order-refund-claim-generation-release.mjs";
import {
  verifyOrderRefundInactiveSellerRecoveryRelease,
} from "../scripts/verify-order-refund-inactive-seller-recovery-release.mjs";
import {
  verifyOrderRefundReconciliationAuthorityRelease,
} from "../scripts/verify-order-refund-reconciliation-authority-release.mjs";
import {
  verifyOrderRefundRecordAuthorityRelease,
} from "../scripts/verify-order-refund-record-authority-release.mjs";

const workflow = readFileSync(
  ".github/workflows/blocked-checkout-refund-delivery-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("workflow binds one protected exact-main compatibility operation", () => {
  assert.match(
    workflow,
    /^name: Blocked Checkout Refund Delivery Production Compatibility$/m,
  );
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
  assert.match(
    workflow,
    /concurrency:\n  group: production-database-migrations\n  cancel-in-progress: false/,
  );
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /github\.repository == 'Drewyoung910\/grainline'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /releaseCommit !== context\.sha/);
  assert.match(workflow, /run\.head_sha !== releaseCommit/);
  assert.match(workflow, /run\.head_branch !== 'main'/);
  assert.match(workflow, /run\.name !== 'CI'/);
  assert.match(workflow, /run\.event !== 'push'/);
  assert.match(workflow, /run\.status !== 'completed'/);
  assert.match(workflow, /run\.conclusion !== 'success'/);
  assert.match(
    workflow,
    /apply-reviewed-blocked-checkout-refund-delivery-compatibility/,
  );
  assert.match(
    workflow,
    /actions\/checkout@v5[\s\S]*ref: \$\{\{ github\.sha \}\}/,
  );
  assert.match(workflow, /persist-credentials: false/);
});

test("workflow admits only the byte-pinned candidate after its live prefix", () => {
  assert.match(
    workflow,
    /latest[\s\S]*20260825010000_prepare_blocked_checkout_refund_delivery/,
  );
  assert.match(
    workflow,
    /audit:order-payment-blocked-checkout-refund-delivery-release/,
  );
  assert.match(
    workflow,
    /Isolate candidate while proving the sealed predecessor tree/,
  );
  const orderedBoundaries = [
    "audit:order-refund-inactive-seller-recovery-release",
    "Isolate Order refund inactive-seller recovery",
    "audit:order-refund-reconciliation-authority-release",
    "Isolate Order refund reconciliation authority",
    "audit:order-payment-signed-authority-release",
    "Isolate Order payment signed authority",
    "audit:order-refund-record-authority-release",
    "Isolate Order refund record authority",
    "audit:order-refund-claim-generation-release",
    "Restore Order refund record authority release",
    "Restore Order payment signed authority release",
    "Restore Order refund reconciliation authority release",
    "Restore Order refund inactive-seller recovery release",
    "Verify predecessor production migration status",
    "Restore candidate migration",
  ];
  let prior = -1;
  for (const boundary of orderedBoundaries) {
    const position = workflow.indexOf(boundary);
    assert.ok(position > prior, `${boundary} must preserve staged release order`);
    prior = position;
  }
  for (const command of [
    "audit:order-refund-claim-generation-release",
    "audit:order-refund-record-authority-release",
    "audit:order-payment-signed-authority-release",
    "audit:order-refund-reconciliation-authority-release",
    "audit:order-refund-inactive-seller-recovery-release",
  ]) assert.equal(typeof pkg.scripts?.[command], "string");
  assert.ok(
    workflow.indexOf("Verify predecessor production migration status")
      < workflow.indexOf("Restore candidate migration"),
  );
  assert.ok(
    workflow.indexOf("Restore candidate migration")
      < workflow.indexOf(
        "- name: Apply blocked-checkout refund delivery compatibility",
      ),
  );
  assert.equal((workflow.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
  assert.match(
    workflow,
    /if: steps\.scope\.outputs\.state == 'delivery-predecessor'[\s\S]*npx prisma migrate deploy/,
  );
});

test("production staging makes each sealed predecessor the visible leaf", () => {
  const root = mkdtempSync(join(tmpdir(), "grainline-blocked-checkout-stack-"));
  const migrations = join(root, "prisma", "migrations");
  cpSync("prisma/migrations", migrations, { recursive: true });
  cpSync("prisma/schema.prisma", join(root, "prisma", "schema.prisma"));
  cpSync("prisma.config.ts", join(root, "prisma.config.ts"));
  mkdirSync(join(root, "src"));
  cpSync("src/middleware.ts", join(root, "src", "middleware.ts"));
  cpSync("docs/rls-drafts", join(root, "docs", "rls-drafts"), {
    recursive: true,
  });
  const remove = (name) => rmSync(join(migrations, name), { recursive: true });
  try {
    remove("20260825010000_prepare_blocked_checkout_refund_delivery");
    verifyOrderRefundInactiveSellerRecoveryRelease(root);
    remove("20260824050000_prepare_order_refund_inactive_seller_recovery");
    verifyOrderRefundReconciliationAuthorityRelease(root);
    remove("20260824040000_prepare_order_refund_reconciliation_authority");
    verifyOrderPaymentSignedAuthorityRelease(root);
    remove("20260824030000_prepare_order_payment_signed_authority");
    verifyOrderRefundRecordAuthorityRelease(root);
    remove("20260824020000_prepare_order_refund_record_authority");
    verifyOrderRefundClaimGenerationRelease(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workflow is restart-safe and verifies the exact resulting authority", () => {
  assert.match(
    workflow,
    /BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_STAGE: restart/,
  );
  assert.match(workflow, /"delivery-predecessor", "delivery-compatible"/);
  assert.match(
    workflow,
    /BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_STAGE: after/,
  );
  assert.match(
    workflow,
    /npm run audit:order-payment-blocked-checkout-refund-delivery-production-scope/,
  );
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/);
  assert.doesNotMatch(workflow, /scripts\/provision-runtime-db-role\.sql/);
  assert.doesNotMatch(
    workflow,
    /vercel|stripe\.com|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|ALTER TABLE/iu,
  );
});

test("package and CI run the real PostgreSQL scope proof after the candidate", () => {
  assert.equal(
    pkg.scripts?.[
      "audit:order-payment-blocked-checkout-refund-delivery-production-scope"
    ],
    "node scripts/verify-blocked-checkout-refund-delivery-production-scope.mjs",
  );
  assert.equal(
    pkg.scripts?.[
      "audit:order-payment-blocked-checkout-refund-delivery-production-scope-postgres"
    ],
    "node scripts/blocked-checkout-refund-delivery-production-scope-postgres-proof.mjs",
  );
  assert.match(
    ci,
    /Prove restart-safe blocked-checkout refund delivery production scope in PostgreSQL 16/,
  );
  assert.match(
    ci,
    /BLOCKED_CHECKOUT_REFUND_DELIVERY_SCOPE_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
  );
  assert.ok(
    ci.indexOf("Apply blocked-checkout refund delivery compatibility")
      < ci.indexOf(
        "Prove restart-safe blocked-checkout refund delivery production scope in PostgreSQL 16",
      ),
  );
});
