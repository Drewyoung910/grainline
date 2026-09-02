import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOrderCompatibleProductionScope,
  readOrderCompatibleProductionSnapshot,
} from "../scripts/verify-order-compatible-production-scope.mjs";

const databaseUrl =
  process.env.ORDER_COMPATIBLE_PRODUCTION_SCOPE_PROOF_DATABASE_URL;

test(
  "Order compatible production scope query matches disposable PostgreSQL",
  { skip: !databaseUrl },
  async () => {
    const snapshot = await readOrderCompatibleProductionSnapshot(databaseUrl, {
      runtimeRole: "grainline_app_runtime",
    });
    const result = assertOrderCompatibleProductionScope(snapshot, "after", {
      migrationRole: "ci",
    });
    assert.equal(result.state, "order-compatible");
    assert.equal(result.migrationPrefixLength, 17);
    assert.equal(result.predecessorRuntimeCrudRetained, true);
  },
);
