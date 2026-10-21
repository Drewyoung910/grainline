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
  assert.equal(result.consumerFiles, 10);
  assert.equal(Object.keys(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS).length, 10);
  assert.equal(result.directWrites, 0);
  assert.equal(result.coordinateFiles, 0);
  assert.equal(result.reviewedOpaqueShapes, 144);
  assert.equal(result.reviewedOpaqueFactoryShapes, 11);
  assert.equal(result.opaqueTargetPredicates, 0);
  assert.equal(result.opaqueNonTargetFactoryCalls, 119);
  assert.equal(result.opaqueNonTargetResiduals, 25);
  assert.deepEqual(result.contractCounts, {
    PUBLIC_PROFILE: 2,
    PUBLIC_ELIGIBILITY: 3,
    PUBLIC_MAP: 1,
    OWNER: 0,
    PARTICIPANT: 1,
    STAFF: 1,
    SERVICE: 1,
    TRANSACTION: 5,
  });
});
