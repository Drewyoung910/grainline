import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS,
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256,
} from "../scripts/order-payment-event-read-authority-catalog.mjs";
import {
  verifyOrderPaymentEventReadAuthorityRelease,
} from "../scripts/verify-order-payment-event-read-authority-release.mjs";

describe("OrderPaymentEvent fixed read-authority release", () => {
  it("is byte-pinned, additive and follows the invariant predecessor", () => {
    const result = verifyOrderPaymentEventReadAuthorityRelease();
    assert.equal(result.migrationSha256, ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256);
    assert.equal(result.runtimeFunctionCount, 5);
    assert.equal(result.rlsChanged, false);
    assert.equal(result.runtimeTablePrivilegesChanged, false);
    assert.equal(result.productionTouched, false);
  });

  it("pins five distinct fixed projections and no generic lookup", () => {
    assert.equal(ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS.length, 5);
    assert.equal(new Set(ORDER_PAYMENT_EVENT_READ_AUTHORITY_FUNCTIONS).size, 5);
    const migration = readFileSync(
      "prisma/migrations/20260829020000_prepare_order_payment_event_read_authority/migration.sql",
      "utf8",
    );
    assert.doesNotMatch(migration, /get_order_payment_event|write_order_payment_event|p_predicate|dynamic sql/i);
    assert.doesNotMatch(migration, /RETURN QUERY EXECUTE/i);
  });

  it("isolates the successor until the invariant proof passes", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const verifyRead = workflow.indexOf("Verify OrderPaymentEvent fixed read-authority release");
    const isolateRead = workflow.indexOf("Isolate OrderPaymentEvent read authority until invariants pass");
    const verifyInvariant = workflow.indexOf("Verify OrderPaymentEvent invariant compatibility release");
    const proveInvariant = workflow.indexOf("Prove OrderPaymentEvent lock and authority invariants through real logins");
    const restoreRead = workflow.indexOf("Restore OrderPaymentEvent fixed read-authority release");
    const proveRead = workflow.indexOf("Prove OrderPaymentEvent read authority through real logins");
    assert.ok(verifyRead >= 0);
    assert.ok(verifyRead < isolateRead);
    assert.ok(isolateRead < verifyInvariant);
    assert.ok(verifyInvariant < proveInvariant);
    assert.ok(proveInvariant < restoreRead);
    assert.ok(restoreRead < proveRead);
    assert.match(workflow, /ORDER_PAYMENT_EVENT_READ_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/);
    assert.match(workflow, /ORDER_PAYMENT_EVENT_READ_PROOF_RUNTIME_DATABASE_URL: postgresql:\/\/grainline_app_runtime:/);
  });

  it("has a restart-safe exact-main production runner and stays out of generic releases", () => {
    const dedicated = readFileSync(
      ".github/workflows/order-payment-event-read-authority-production.yml",
      "utf8",
    );
    const invariant = readFileSync(
      ".github/workflows/order-payment-event-invariants-production.yml",
      "utf8",
    );
    const generic = readFileSync(
      ".github/workflows/production-migrations.yml",
      "utf8",
    );
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));

    assert.match(dedicated, /environment: Production/);
    assert.match(dedicated, /mainCi\.head_sha !== releaseCommit/);
    assert.match(dedicated, /inspection\.head_sha !== releaseCommit/);
    assert.match(dedicated, /Order Payment Shipping Legacy Inspection/);
    assert.match(dedicated, /guard-production-migration-runner\.mjs/);
    assert.match(
      dedicated,
      /latest[\s\S]*20260829020000_prepare_order_payment_event_read_authority/,
    );
    assert.match(
      dedicated,
      /ORDER_PAYMENT_EVENT_READ_AUTHORITY_SCOPE_STAGE: restart/,
    );
    assert.match(
      dedicated,
      /"read-authority-predecessor", "read-authority-prepared"/,
    );
    assert.match(
      dedicated,
      /if: steps\.scope\.outputs\.state == 'read-authority-predecessor'[\s\S]*npx prisma migrate deploy/,
    );
    assert.equal((dedicated.match(/npx prisma migrate deploy/gu) ?? []).length, 1);
    assert.match(
      dedicated,
      /ORDER_PAYMENT_EVENT_READ_AUTHORITY_SCOPE_STAGE: after/,
    );
    assert.match(dedicated, /audit:db-grants -- --require-direct-url/);
    assert.doesNotMatch(
      dedicated,
      /vercel deploy|stripe|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/i,
    );

    const genericReadVerify = generic.indexOf(
      "Verify isolated OrderPaymentEvent read-authority successor",
    );
    const genericInvariantVerify = generic.indexOf(
      "npm run audit:order-payment-event-invariants-release",
    );
    const genericReadIsolate = generic.indexOf(
      "Isolate unapplied OrderPaymentEvent read-authority successor",
    );
    assert.ok(genericReadVerify >= 0);
    assert.ok(genericInvariantVerify > genericReadVerify);
    assert.ok(
      genericReadIsolate > genericInvariantVerify,
      "activation must verify the complete successor chain before isolation",
    );

    const invariantReadVerify = invariant.indexOf(
      "Verify isolated OrderPaymentEvent read-authority successor",
    );
    const invariantReadIsolate = invariant.indexOf(
      "Isolate unapplied OrderPaymentEvent read-authority successor",
    );
    const invariantVerify = invariant.indexOf(
      "npm run audit:order-payment-event-invariants-release",
      invariantReadIsolate,
    );
    assert.ok(invariantReadVerify >= 0 && invariantReadVerify < invariantReadIsolate);
    assert.ok(invariantReadIsolate < invariantVerify);
    assert.equal(
      pkg.scripts?.[
        "audit:order-payment-event-read-authority-production-scope"
      ],
      "node scripts/verify-order-payment-event-read-authority-production-scope.mjs",
    );
    assert.equal(
      pkg.scripts?.["audit:order-payment-event-read-authority-ci-scope"],
      "node scripts/order-payment-event-read-authority-ci-scope-proof.mjs",
    );
    assert.match(
      ci,
      /Prove exact OrderPaymentEvent read-authority scope in CI[\s\S]*?audit:order-payment-event-read-authority-ci-scope/,
    );
    assert.doesNotMatch(
      ci,
      /ORDER_PAYMENT_EVENT_READ_AUTHORITY_SCOPE_STAGE: after/,
    );
  });
});
