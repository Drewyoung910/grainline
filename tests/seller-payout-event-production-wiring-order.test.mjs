import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);

const AUTHORITY_MIGRATION =
  "20260815210000_prepare_seller_payout_event_authority";
const AUTHORITY_TEMP = "seller-payout-event-authority-release";

test("production wiring hides the payout authority successor from older seals", () => {
  const verifyAuthority = workflow.indexOf(
    "Verify sealed SellerPayoutEvent authority predecessor",
  );
  const isolateAuthority = workflow.indexOf(
    "Isolate the reviewed SellerPayoutEvent authority predecessor",
  );
  const verifyReservationForce = workflow.indexOf(
    "Verify exact CheckoutStockReservation FORCE migration tree",
  );
  const restoreReservationForce = workflow.indexOf(
    "Restore the reviewed CheckoutStockReservation FORCE release",
  );
  const restoreAuthority = workflow.indexOf(
    "Restore the reviewed SellerPayoutEvent authority predecessor",
  );
  const restoreActivation = workflow.indexOf(
    "Restore the reviewed SellerPayoutEvent activation release",
  );

  assert.ok(verifyAuthority >= 0);
  assert.ok(verifyAuthority < isolateAuthority);
  assert.ok(isolateAuthority < verifyReservationForce);
  assert.ok(restoreReservationForce < restoreAuthority);
  assert.ok(restoreAuthority < restoreActivation);

  const isolatePattern = new RegExp(
    String.raw`Isolate the reviewed SellerPayoutEvent authority predecessor[\s\S]*?mv\s+prisma/migrations/${AUTHORITY_MIGRATION}\s+"\$RUNNER_TEMP/${AUTHORITY_TEMP}"`,
    "u",
  );
  const restorePattern = new RegExp(
    String.raw`Restore the reviewed SellerPayoutEvent authority predecessor[\s\S]*?mv\s+"\$RUNNER_TEMP/${AUTHORITY_TEMP}"\s+prisma/migrations/${AUTHORITY_MIGRATION}`,
    "u",
  );

  assert.match(workflow, isolatePattern);
  assert.match(workflow, restorePattern);
});

test("the payout authority migration has exactly one isolate and restore move", () => {
  const migrationMatches = workflow.match(
    new RegExp(`prisma/migrations/${AUTHORITY_MIGRATION}`, "gu"),
  );
  const tempMatches = workflow.match(
    new RegExp(`\\$RUNNER_TEMP/${AUTHORITY_TEMP}`, "gu"),
  );

  assert.equal(migrationMatches?.length, 2);
  assert.equal(tempMatches?.length, 2);
});
