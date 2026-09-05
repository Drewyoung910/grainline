import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const plan = fs.readFileSync(
  "docs/order-zero-direct-compatible-packaging-plan.md",
  "utf8",
);

const migrationMembers = [
  "20260905010000_correct_order_staff_read_charged_total",
  "20260905020000_prepare_order_account_deletion_authority",
];

const draftMembers = [
  "order-provider-claim-exclusion.sql",
  "order-refund-claim-clock-authority.sql",
  "order-seller-refund-preflight-authority.sql",
  "order-legacy-refund-lock-authority.sql",
  "order-legacy-stock-restore-fence.sql",
  "order-refund-reconciliation-commit-proof.sql",
  "order-staff-mutation-authority.sql",
  "order-ban-review-authority.sql",
  "order-checkout-source-snapshot.sql",
  "order-seller-deauthorization-authority.sql",
  "order-paid-checkout-authority.sql",
  "order-checkout-existing-authority.sql",
  "order-checkout-postpayment-authority.sql",
  "order-checkout-refund-review-authority.sql",
];

describe("Order zero-direct compatible packaging plan", () => {
  it("pins the complete sixteen-member compatible prefix", () => {
    assert.equal(migrationMembers.length, 2);
    assert.equal(draftMembers.length, 14);
    for (const migration of migrationMembers) {
      assert.equal(
        fs.existsSync(path.join("prisma/migrations", migration, "migration.sql")),
        true,
        migration,
      );
      assert.match(plan, new RegExp(migration));
    }
    for (const draft of draftMembers) {
      assert.equal(fs.existsSync(path.join("docs/rls-drafts", draft)), true, draft);
      assert.match(plan, new RegExp(draft.replaceAll(".", "\\.")));
    }
  });

  it("keeps Order posture and predecessor CRUD unchanged during preparation", () => {
    for (const member of draftMembers) {
      const sql = fs.readFileSync(path.join("docs/rls-drafts", member), "utf8");
      assert.doesNotMatch(
        sql,
        /ALTER TABLE public\."Order" (?:ENABLE|DISABLE|FORCE|NO FORCE) ROW LEVEL SECURITY/,
        member,
      );
      assert.doesNotMatch(
        sql,
        /(?:GRANT|REVOKE)[\s\S]{0,200}ON TABLE public\."Order"/,
        member,
      );
    }
    assert.match(plan, /RLS and FORCE off/);
    assert.match(plan, /predecessor ordinary-runtime CRUD still present/);
    assert.match(plan, /policyless FORCE\s+`SellerDeauthorizationApplication`/);
  });

  it("keeps credentials, activation, and successor tables separate", () => {
    assert.match(plan, /dedicated staff-read login and secret remain a separate/);
    assert.match(plan, /not grant them to an unproved login/);
    assert.match(plan, /missing, unknown, duplicate, rolled-back, incomplete or checksum-drifted/);
    assert.match(plan, /distinct actual pooled-runtime postflight/);
    assert.match(plan, /Order policyless ENABLE plus direct-grant revocation/);
    assert.match(plan, /package FORCE as a\s+separate posture-only release/);
    assert.match(plan, /`OrderItem`, then `OrderShippingRateQuote`, separately/);
  });
});
