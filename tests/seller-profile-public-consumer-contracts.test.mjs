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
  assert.equal(result.consumerFiles, 68);
  assert.equal(Object.keys(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS).length, 68);
  assert.equal(result.directWrites, 13);
  assert.equal(result.coordinateFiles, 1);
  assert.equal(result.reviewedOpaqueShapes, 172);
  assert.equal(result.reviewedOpaqueFactoryShapes, 12);
  assert.equal(result.opaqueTargetPredicates, 9);
  assert.equal(result.opaqueNonTargetFactoryCalls, 141);
  assert.equal(result.opaqueNonTargetResiduals, 22);
  assert.deepEqual(result.contractCounts, {
    PUBLIC_PROFILE: 26,
    PUBLIC_ELIGIBILITY: 32,
    PUBLIC_MAP: 4,
    OWNER: 7,
    PARTICIPANT: 12,
    STAFF: 7,
    SERVICE: 12,
    TRANSACTION: 11,
  });
});
