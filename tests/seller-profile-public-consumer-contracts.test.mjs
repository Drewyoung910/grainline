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
  assert.equal(result.consumerFiles, 46);
  assert.equal(Object.keys(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS).length, 46);
  assert.equal(result.directWrites, 0);
  assert.equal(result.coordinateFiles, 0);
  assert.equal(result.reviewedOpaqueShapes, 148);
  assert.equal(result.reviewedOpaqueFactoryShapes, 11);
  assert.equal(result.opaqueTargetPredicates, 0);
  assert.equal(result.opaqueNonTargetFactoryCalls, 126);
  assert.equal(result.opaqueNonTargetResiduals, 22);
  assert.deepEqual(result.contractCounts, {
    PUBLIC_PROFILE: 19,
    PUBLIC_ELIGIBILITY: 21,
    PUBLIC_MAP: 2,
    OWNER: 3,
    PARTICIPANT: 11,
    STAFF: 4,
    SERVICE: 5,
    TRANSACTION: 10,
  });
});
