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
  assert.equal(result.consumerFiles, 57);
  assert.equal(Object.keys(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS).length, 57);
  assert.equal(result.directWrites, 8);
  assert.equal(result.coordinateFiles, 1);
  assert.equal(result.reviewedOpaqueShapes, 169);
  assert.equal(result.reviewedOpaqueFactoryShapes, 12);
  assert.equal(result.opaqueTargetPredicates, 8);
  assert.equal(result.opaqueNonTargetFactoryCalls, 139);
  assert.equal(result.opaqueNonTargetResiduals, 22);
  assert.deepEqual(result.contractCounts, {
    PUBLIC_PROFILE: 23,
    PUBLIC_ELIGIBILITY: 28,
    PUBLIC_MAP: 3,
    OWNER: 5,
    PARTICIPANT: 11,
    STAFF: 6,
    SERVICE: 7,
    TRANSACTION: 10,
  });
});
