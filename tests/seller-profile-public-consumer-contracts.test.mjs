import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS,
  verifySellerProfilePublicConsumerContracts,
} from "../scripts/seller-profile-public-consumer-contracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every SellerProfile source consumer has a bounded authority contract", () => {
  const result = verifySellerProfilePublicConsumerContracts(root);
  assert.equal(result.consumerFiles, 0);
  assert.equal(Object.keys(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS).length, 0);
  assert.equal(result.directWrites, 0);
  assert.equal(result.coordinateFiles, 0);
  // Three direct EmailSuppression write arguments and the StockNotification
  // listing-availability query leave the opaque frontier when those checks
  // move behind their fixed SQL authorities.
  // The 2026-11-04 fix branch: C-1882 removes seven build-time factory reads,
  // C-261 adds three to empty-page metadata, C-1890 removes one residual.
  assert.equal(result.reviewedOpaqueShapes, 144);
  assert.equal(result.reviewedOpaqueFactoryShapes, 11);
  assert.equal(result.opaqueTargetPredicates, 0);
  assert.equal(result.opaqueNonTargetFactoryCalls, 118);
  assert.equal(result.opaqueNonTargetResiduals, 26);
  assert.deepEqual(result.contractCounts, {
    PUBLIC_PROFILE: 0,
    PUBLIC_ELIGIBILITY: 0,
    PUBLIC_MAP: 0,
    OWNER: 0,
    PARTICIPANT: 0,
    STAFF: 0,
    SERVICE: 0,
    TRANSACTION: 0,
  });
});
