import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convergeLocalRuntimeEnvironmentSource } from "../scripts/converge-local-runtime-db-env.mjs";

const OWNER_POOLER = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech/neondb?sslmode=require&channel_binding=require";
const OWNER_DIRECT = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const RUNTIME = "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

describe("local runtime database environment convergence", () => {
  it("replaces only DATABASE_URL and removes the reviewed stale DIRECT_URL", () => {
    const source = [
      "FIRST_SECRET=unchanged-one",
      `DATABASE_URL=\"${OWNER_POOLER}\"`,
      `DIRECT_URL=\"${OWNER_DIRECT}\"`,
      "OTHER_SECRET='unchanged two'",
      "",
    ].join("\n");
    const result = convergeLocalRuntimeEnvironmentSource(source, RUNTIME);
    assert.equal(result.priorDatabaseRole, "neondb_owner");
    assert.equal(result.directUrlRemoved, true);
    assert.equal(result.changed, true);
    assert.equal(result.source.includes(`DATABASE_URL=\"${RUNTIME}\"`), true);
    assert.equal(result.source.includes("DIRECT_URL="), false);
    assert.equal(result.source.includes("FIRST_SECRET=unchanged-one"), true);
    assert.equal(result.source.includes("OTHER_SECRET='unchanged two'"), true);
  });

  it("is idempotent once the local environment is runtime-only", () => {
    const source = `DATABASE_URL=\"${RUNTIME}\"\nOTHER=value\n`;
    const result = convergeLocalRuntimeEnvironmentSource(source, RUNTIME);
    assert.equal(result.priorDatabaseRole, "grainline_app_runtime");
    assert.equal(result.directUrlRemoved, false);
    assert.equal(result.changed, false);
    assert.equal(result.source, source);
  });

  it("rejects duplicates, wrong predecessors, and aliased PostgreSQL URLs", () => {
    assert.throws(() => convergeLocalRuntimeEnvironmentSource(
      `DATABASE_URL=\"${OWNER_POOLER}\"\nDATABASE_URL=\"${OWNER_POOLER}\"\n`,
      RUNTIME,
    ), /count/);
    assert.throws(() => convergeLocalRuntimeEnvironmentSource(
      `DATABASE_URL=\"${OWNER_POOLER.replace("neondb_owner", "other_role")}\"\n`,
      RUNTIME,
    ), /predecessor/);
    assert.throws(() => convergeLocalRuntimeEnvironmentSource(
      `DATABASE_URL=\"${OWNER_POOLER}\"\nSHADOW_URL=\"${OWNER_DIRECT}\"\n`,
      RUNTIME,
    ), /unreviewed/);
  });
});
