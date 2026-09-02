import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ORDER_COMPATIBLE_PRIVATE_FUNCTIONS,
  ORDER_COMPATIBLE_RUNTIME_FUNCTIONS,
  ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_CONFIRMATION,
  assertOrderCompatibleRuntimeGitState,
  orderCompatibleFunctionSourceSha256,
  parseOrderCompatibleRuntimePostflightConfig,
  writeOrderCompatibleRuntimePostflightEvidence,
} from "../scripts/order-compatible-runtime-postflight.mjs";
import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
} from "../scripts/guard-runtime-db-env.mjs";

const RELEASE = "a".repeat(40);
const DATABASE_URL = `postgresql://grainline_app_runtime:runtime@${
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY.endpointId
}-pooler.${REVIEWED_PRODUCTION_RUNTIME_IDENTITY.region}.neon.tech:5432/${
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY.databaseName
}?sslmode=verify-full&channel_binding=require`;

function validEnv(evidencePath) {
  return {
    ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_CONFIRM:
      ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_CONFIRMATION,
    ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_EVIDENCE_PATH: evidencePath,
    ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_MAIN_CI_RUN_ID: "1",
    ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_MIGRATION_RUN_ID: "2",
    ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_RELEASE_COMMIT: RELEASE,
    DATABASE_URL,
    TZ: "UTC",
  };
}

describe("Order compatible runtime postflight", () => {
  it("pins the complete runtime and private function sets", () => {
    assert.equal(ORDER_COMPATIBLE_RUNTIME_FUNCTIONS.length, 40);
    assert.equal(ORDER_COMPATIBLE_PRIVATE_FUNCTIONS.length, 8);
    assert.equal(
      new Set([
        ...ORDER_COMPATIBLE_RUNTIME_FUNCTIONS,
        ...ORDER_COMPATIBLE_PRIVATE_FUNCTIONS,
      ]).size,
      48,
    );
    assert.ok(
      ORDER_COMPATIBLE_PRIVATE_FUNCTIONS.includes(
        "grainline_order_staff_detail(text,text)",
      ),
    );
    assert.ok(
      ORDER_COMPATIBLE_PRIVATE_FUNCTIONS.includes(
        'grainline_notification_create_core(text,text,public."NotificationType",text,text,text)',
      ),
    );
    assert.equal(
      Object.keys(orderCompatibleFunctionSourceSha256()).length,
      48,
    );
  });

  it("accepts only the reviewed pooled runtime shape and fresh evidence path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "order-runtime-postflight-"));
    const evidencePath = path.join(
      root,
      `order-compatible-runtime-postflight-${RELEASE}.json`,
    );
    const parsed = parseOrderCompatibleRuntimePostflightConfig(
      validEnv(evidencePath),
    );
    assert.equal(parsed.releaseCommit, RELEASE);
    assert.equal(parsed.mainCiRunId, 1);
    assert.equal(parsed.migrationRunId, 2);
    assert.equal(parsed.runtimeGuard.runtimeRole, "grainline_app_runtime");

    for (const patch of [
      { ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_CONFIRM: "wrong" },
      { DIRECT_URL: DATABASE_URL },
      { DATABASE_URL: DATABASE_URL.replace("-pooler.", ".") },
      { ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_MAIN_CI_RUN_ID: "0" },
      { ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_RELEASE_COMMIT: "short" },
      {
        ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_EVIDENCE_PATH:
          path.join(root, "wrong.json"),
      },
    ]) {
      assert.throws(() =>
        parseOrderCompatibleRuntimePostflightConfig({
          ...validEnv(evidencePath),
          ...patch,
        })
      );
    }
  });

  it("requires exact clean git state", () => {
    assert.deepEqual(
      assertOrderCompatibleRuntimeGitState({ head: RELEASE, status: "" }, RELEASE),
      { clean: true, head: RELEASE },
    );
    assert.throws(() =>
      assertOrderCompatibleRuntimeGitState({ head: "b".repeat(40), status: "" }, RELEASE)
    );
    assert.throws(() =>
      assertOrderCompatibleRuntimeGitState({ head: RELEASE, status: " M file" }, RELEASE)
    );
  });

  it("writes fresh mode-0600 evidence only", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "order-runtime-evidence-"));
    const evidencePath = path.join(root, "evidence.json");
    writeOrderCompatibleRuntimePostflightEvidence(evidencePath, {
      status: "passed",
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(evidencePath, "utf8")), {
      status: "passed",
    });
    assert.equal(fs.statSync(evidencePath).mode & 0o777, 0o600);
    assert.throws(() =>
      writeOrderCompatibleRuntimePostflightEvidence(evidencePath, {
        status: "passed",
      })
    );
  });
});
