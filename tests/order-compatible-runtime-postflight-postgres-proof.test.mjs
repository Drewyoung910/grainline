import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  parseOrderCompatibleRuntimePostflightProofConfig,
} from "../scripts/order-compatible-runtime-postflight-postgres-proof.mjs";

const LOOPBACK_URL =
  "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";

describe("Order compatible runtime postflight PostgreSQL proof", () => {
  it("accepts only the disposable loopback owner database", () => {
    assert.equal(
      parseOrderCompatibleRuntimePostflightProofConfig({
        ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_PROOF_DATABASE_URL: LOOPBACK_URL,
      }).databaseUrl,
      LOOPBACK_URL,
    );
    for (const databaseUrl of [
      LOOPBACK_URL.replace("127.0.0.1", "example.com"),
      LOOPBACK_URL.replace("grainline_ci", "production"),
      LOOPBACK_URL.replace("ci:ci@", "grainline_app_runtime:runtime@"),
    ]) {
      assert.throws(() =>
        parseOrderCompatibleRuntimePostflightProofConfig({
          ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_PROOF_DATABASE_URL: databaseUrl,
        })
      );
    }
  });

  it("temporarily authenticates runtime and always removes the proof password", () => {
    const source = fs.readFileSync(
      "scripts/order-compatible-runtime-postflight-postgres-proof.mjs",
      "utf8",
    );
    assert.match(
      source,
      /ALTER ROLE grainline_app_runtime\s+PASSWORD 'order-compatible-runtime-postflight-proof'/,
    );
    assert.match(
      source,
      /finally \{[\s\S]*ALTER ROLE grainline_app_runtime PASSWORD NULL/,
    );
    assert.match(source, /runOrderCompatibleRuntimePostflight/);
    const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(
      workflow,
      /Prove Order compatible postflight through the runtime login[\s\S]{0,300}ORDER_COMPATIBLE_RUNTIME_POSTFLIGHT_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
    );
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    assert.equal(
      packageJson.scripts["audit:rls-order-compatible-runtime-postflight"],
      "node scripts/order-compatible-runtime-postflight-postgres-proof.mjs",
    );
  });
});
