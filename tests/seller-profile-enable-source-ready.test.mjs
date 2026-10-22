import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSellerProfileEnableSourceReady,
} from "../scripts/assert-seller-profile-enable-source-ready.mjs";

test("SellerProfile ENABLE source gate accepts a zero-base-authority inventory", () => {
  assert.deepEqual(assertSellerProfileEnableSourceReady({
    directCount: 0,
    relationCount: 0,
    rawSqlCount: 0,
    factoryRelations: [],
    opaqueShapes: [],
  }), {
    direct: 0,
    relations: 0,
    rawSql: 0,
    relationFactories: 0,
    targetOpaquePredicates: 0,
  });
});

test("SellerProfile ENABLE source gate rejects every residual consumer class", () => {
  for (const report of [
    { directCount: 1, relationCount: 0, rawSqlCount: 0 },
    { directCount: 0, relationCount: 1, rawSqlCount: 0 },
    { directCount: 0, relationCount: 0, rawSqlCount: 1 },
    {
      directCount: 0,
      relationCount: 0,
      rawSqlCount: 0,
      factoryRelations: [{ model: "Listing" }],
    },
    {
      directCount: 0,
      relationCount: 0,
      rawSqlCount: 0,
      opaqueShapes: [{ model: "SellerProfile" }],
    },
  ]) {
    assert.throws(
      () => assertSellerProfileEnableSourceReady(report),
      /SellerProfile ENABLE is blocked by residual base-table consumers/u,
    );
  }
});
