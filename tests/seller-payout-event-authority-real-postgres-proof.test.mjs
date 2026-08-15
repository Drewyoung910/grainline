import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  parseSellerPayoutEventAuthorityProofConfig,
} from "../scripts/seller-payout-event-authority-postgres-proof.mjs";

const source = readFileSync(
  "scripts/seller-payout-event-authority-postgres-proof.mjs",
  "utf8",
);

test("seller payout real-PostgreSQL proof refuses non-loopback or runtime credentials", () => {
  assert.throws(
    () => parseSellerPayoutEventAuthorityProofConfig({}),
    /is required/,
  );
  assert.throws(
    () => parseSellerPayoutEventAuthorityProofConfig({
      SELLER_PAYOUT_EVENT_AUTHORITY_PROOF_DATABASE_URL:
        "postgresql://ci:secret@db.example.com:5432/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseSellerPayoutEventAuthorityProofConfig({
      SELLER_PAYOUT_EVENT_AUTHORITY_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:secret@localhost:5432/grainline_ci",
    }),
    /Expected values to be strictly equal/,
  );
});

test("seller payout real-PostgreSQL proof covers role, source, projection, race and cleanup", () => {
  assert.match(source, /CURRENT_USER AS current_user/);
  assert.match(source, /SET LOCAL ROLE \$\{RUNTIME_ROLE\}/);
  assert.match(source, /forged payout source/);
  assert.match(source, /ignored_unknown_account/);
  assert.match(source, /grainline_seller_payout_latest_failure/);
  assert.match(source, /grainline_seller_payout_export_page/);
  assert.match(source, /wait_event = 'advisory'/);
  assert.match(source, /concurrentPromises = \[oldPromise, newPromise\]/);
  assert.match(source, /Promise\.all\(concurrentPromises\)/);
  assert.match(source, /await cleanFixtures\(admin\)\.catch/);
  assert.match(source, /productionTouched: false/);
});
