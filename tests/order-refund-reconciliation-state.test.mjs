import assert from "node:assert/strict";
import test from "node:test";

const {
  chooseOrderRefundReconciliationAction,
  ORDER_REFUND_RECONCILIATION_WINDOWS,
} = await import("../src/lib/orderRefundReconciliationState.ts");

function inspection(disposition, ageSeconds) {
  return {
    disposition,
    inspectedAtSeconds: 1_000_000 + ageSeconds,
    providerEvidenceSha256: "a".repeat(64),
    providerResult: disposition === "USABLE_REFUND" ? {} : null,
  };
}

const claim = { providerAuthorizedAtSeconds: 1_000_000 };

test("refund reconciliation retries only an absent claim before 23 hours", () => {
  assert.deepEqual(
    chooseOrderRefundReconciliationAction(
      claim,
      inspection("ABSENT", ORDER_REFUND_RECONCILIATION_WINDOWS.retrySeconds - 1),
    ),
    { action: "RETRY_EXISTING_SCOPE", waitUntilSeconds: null },
  );
  assert.equal(
    chooseOrderRefundReconciliationAction(
      claim,
      inspection("ABSENT", ORDER_REFUND_RECONCILIATION_WINDOWS.retrySeconds),
    ).action,
    null,
  );
});

test("refund reconciliation records one exact provider effect at every age", () => {
  for (const ageSeconds of [0, 24 * 60 * 60, 30 * 60 * 60]) {
    assert.equal(
      chooseOrderRefundReconciliationAction(
        claim,
        inspection("USABLE_REFUND", ageSeconds),
      ).action,
      "CONFIRMED_PROVIDER_EFFECT",
    );
  }
});

test("refund reconciliation releases no-effect evidence only at 25 hours", () => {
  for (const disposition of ["ABSENT", "TERMINAL_NO_EFFECT"]) {
    assert.equal(
      chooseOrderRefundReconciliationAction(
        claim,
        inspection(
          disposition,
          ORDER_REFUND_RECONCILIATION_WINDOWS.releaseSeconds - 1,
        ),
      ).action,
      null,
    );
    assert.equal(
      chooseOrderRefundReconciliationAction(
        claim,
        inspection(disposition, ORDER_REFUND_RECONCILIATION_WINDOWS.releaseSeconds),
      ).action,
      "CONFIRMED_NO_PROVIDER_EFFECT",
    );
  }
});

test("refund reconciliation rejects provider evidence older than claim authority", () => {
  assert.throws(
    () => chooseOrderRefundReconciliationAction(
      claim,
      inspection("ABSENT", -1),
    ),
    /predates claim authority/,
  );
});
