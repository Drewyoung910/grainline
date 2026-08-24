import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  parseOrderRefundInactiveSellerRecoveryProofConfig,
} from "../scripts/order-refund-inactive-seller-recovery-postgres-proof.mjs";

test("inactive-seller PostgreSQL proof is loopback and migration-role only", () => {
  assert.throws(
    () => parseOrderRefundInactiveSellerRecoveryProofConfig({}),
    /is required/,
  );
  assert.throws(
    () => parseOrderRefundInactiveSellerRecoveryProofConfig({
      ORDER_REFUND_INACTIVE_SELLER_RECOVERY_PROOF_DATABASE_URL:
        "postgresql://ci:secret@production.example/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseOrderRefundInactiveSellerRecoveryProofConfig({
      ORDER_REFUND_INACTIVE_SELLER_RECOVERY_PROOF_DATABASE_URL:
        "postgresql://wrong:secret@localhost/grainline_ci",
    }),
    /Expected values to be strictly equal/,
  );
  const parsed = parseOrderRefundInactiveSellerRecoveryProofConfig({
    ORDER_REFUND_INACTIVE_SELLER_RECOVERY_PROOF_DATABASE_URL:
      "postgresql://ci:secret@localhost/grainline_ci",
  });
  assert.match(parsed.databaseUrl, /^postgresql:\/\/ci:/);
});

test("real PostgreSQL proof uses runtime role, rollback, and zero-residue checks", () => {
  const proof = fs.readFileSync(
    "scripts/order-refund-inactive-seller-recovery-postgres-proof.mjs",
    "utf8",
  );
  assert.match(proof, /SET LOCAL ROLE \$\{RUNTIME_ROLE\}/);
  assert.match(proof, /inactive seller without reconciliation/);
  assert.match(proof, /CONFIRMED_PROVIDER_EFFECT/);
  assert.match(proof, /lacks exact ADMIN reconciliation/);
  assert.match(proof, /FOR SHARE OF reconciliation, administrator/);
  assert.match(proof, /AS "listingStatus"/);
  assert.match(proof, /AS "eventClaimId"/);
  assert.match(proof, /AS "eventSourceId"/);
  assert.match(proof, /await client\.query\("ROLLBACK"\)/);
  assert.match(proof, /residue\.rows\[0\]\.count, 0/);
});
