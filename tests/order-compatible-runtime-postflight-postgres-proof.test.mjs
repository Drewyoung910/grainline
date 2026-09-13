import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  parseOrderCompatibleRuntimePostflightProofConfig,
} from "../scripts/order-compatible-runtime-postflight-postgres-proof.mjs";
import {
  orderCompatibleFunctionSourceSha256,
} from "../scripts/order-compatible-runtime-postflight.mjs";

const LOOPBACK_URL =
  "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";

describe("Order compatible runtime postflight PostgreSQL proof", () => {
  it("proves the historical catalog before any source-replacing successor is restored", () => {
    const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    const names = [...workflow.matchAll(/^      - name: (.+)$/gm)].map((match) => match[1]);
    const index = (name) => {
      assert.equal(names.filter((entry) => entry === name).length, 1, name);
      return names.indexOf(name);
    };
    const restore = index("Restore Order participant list projection correction");
    const apply = index("Apply historical Order compatibility prefix before successors");
    const grants = index("Converge historical Order compatibility runtime grants");
    const historical = index("Prove Order compatible postflight through the runtime login");
    assert.ok(restore < apply && apply < grants && grants < historical);
    for (const successor of [
      "Restore additive Case and Order correctness release",
      "Restore Order staff charged-total correction",
      "Restore compatible Order account-deletion authority",
      "Restore complete Order zero-direct compatible suffix",
    ]) assert.ok(historical < index(successor), successor);
    assert.ok(index("Restore complete Order zero-direct compatible suffix")
      < index("Apply compatible Order participant authority"));
    assert.ok(index("Apply compatible Order participant authority")
      < index("Prove complete Order zero-direct prefix in disposable PostgreSQL"));
    // Keep the historical contract strict. The current composition successor
    // has a different body and must not be accepted by this predecessor proof.
    assert.equal(orderCompatibleFunctionSourceSha256().grainline_order_review_eligibility_lock,
      "609a946ad5b67d76f0ea31688125bf3ee2c84e846af036d85461194be43ef8cf");
  });

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
