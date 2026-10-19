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
  assert.equal(result.consumerFiles, 94);
  assert.equal(Object.keys(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS).length, 94);
  assert.equal(result.directWrites, 14);
  assert.equal(result.coordinateFiles, 2);
  assert.equal(result.reviewedOpaqueShapes, 203);
  assert.equal(result.reviewedOpaqueFactoryShapes, 12);
  assert.equal(result.opaqueTargetPredicates, 32);
  assert.equal(result.opaqueNonTargetFactoryCalls, 149);
  assert.equal(result.opaqueNonTargetResiduals, 22);
  assert.deepEqual(result.contractCounts, {
    PUBLIC_PROFILE: 33,
    PUBLIC_ELIGIBILITY: 41,
    PUBLIC_MAP: 4,
    OWNER: 22,
    PARTICIPANT: 15,
    STAFF: 7,
    SERVICE: 14,
    TRANSACTION: 14,
  });
});
