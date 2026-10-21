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
  assert.equal(result.consumerFiles, 17);
  assert.equal(Object.keys(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS).length, 17);
  assert.equal(result.directWrites, 0);
  assert.equal(result.coordinateFiles, 0);
  assert.equal(result.reviewedOpaqueShapes, 144);
  assert.equal(result.reviewedOpaqueFactoryShapes, 11);
  assert.equal(result.opaqueTargetPredicates, 0);
  assert.equal(result.opaqueNonTargetFactoryCalls, 119);
  assert.equal(result.opaqueNonTargetResiduals, 25);
  assert.deepEqual(result.contractCounts, {
    PUBLIC_PROFILE: 3,
    PUBLIC_ELIGIBILITY: 6,
    PUBLIC_MAP: 1,
    OWNER: 0,
    PARTICIPANT: 6,
    STAFF: 3,
    SERVICE: 1,
    TRANSACTION: 7,
  });
});
