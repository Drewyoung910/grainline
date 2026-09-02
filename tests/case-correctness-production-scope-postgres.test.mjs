import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCaseCorrectnessProductionScope,
  readCaseCorrectnessProductionSnapshot,
} from "../scripts/verify-case-correctness-production-scope.mjs";

const databaseUrl =
  process.env.CASE_CORRECTNESS_PRODUCTION_SCOPE_PROOF_DATABASE_URL;

test(
  "Case correctness production scope query matches disposable PostgreSQL",
  { skip: !databaseUrl },
  async () => {
    const snapshot = await readCaseCorrectnessProductionSnapshot(databaseUrl, {
      runtimeRole: "grainline_app_runtime",
    });
    const result = assertCaseCorrectnessProductionScope(snapshot, "after", {
      migrationRole: "ci",
    });
    assert.equal(result.state, "case-corrected");
    assert.equal(result.orderMigrationCount, 18);
    assert.equal(result.directRuntimeCrud, false);
  },
);
