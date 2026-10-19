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
  assert.equal(result.consumerFiles, 100);
  assert.equal(Object.keys(SELLER_PROFILE_PUBLIC_CONSUMER_CONTRACTS).length, 100);
  assert.equal(result.directWrites, 14);
  assert.equal(result.coordinateFiles, 7);
  assert.deepEqual(result.contractCounts, {
    PUBLIC_PROFILE: 34,
    PUBLIC_ELIGIBILITY: 47,
    PUBLIC_MAP: 5,
    OWNER: 22,
    PARTICIPANT: 15,
    STAFF: 7,
    SERVICE: 14,
    TRANSACTION: 14,
  });
});
