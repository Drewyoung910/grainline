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
  }), { direct: 0, relations: 0, rawSql: 0 });
});

test("SellerProfile ENABLE source gate rejects every residual consumer class", () => {
  for (const report of [
    { directCount: 1, relationCount: 0, rawSqlCount: 0 },
    { directCount: 0, relationCount: 1, rawSqlCount: 0 },
    { directCount: 0, relationCount: 0, rawSqlCount: 1 },
  ]) {
    assert.throws(
      () => assertSellerProfileEnableSourceReady(report),
      /SellerProfile ENABLE is blocked by residual base-table consumers/u,
    );
  }
});
