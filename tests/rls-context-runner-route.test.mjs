import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const route = readFileSync("src/app/api/internal/rls-context-gate/route.ts", "utf8");
const middleware = readFileSync("src/middleware.ts", "utf8");

describe("RLS context provider-runtime runner", () => {
  it("is fail-closed outside Preview and requires a bounded timing-safe token", () => {
    assert.match(route, /process\.env\.VERCEL_ENV !== ["']preview["']/);
    assert.match(route, /RLS_CONTEXT_GATE_TRIGGER_SECRET/);
    assert.match(route, /timingSafeEqual\(digest\(provided\), digest\(expected!\)\)/);
    assert.match(route, /readBoundedJson\(request, BODY_MAX_BYTES\)/);
    assert.match(route, /runSlot: z\.union\(\[z\.literal\(1\), z\.literal\(2\)\]\)/);
    assert.match(route, /export const maxDuration = 300/);
  });

  it("is repeat-only, commit-pinned, and atomically consumes each of two durable run slots", () => {
    assert.match(route, /RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA/);
    assert.match(route, /allowedCommitSha === process\.env\.VERCEL_GIT_COMMIT_SHA/);
    assert.match(route, /RLS_CONTEXT_GATE_RUN_ID/);
    assert.match(route, /claimProviderRuntimeRunSlot/);
    assert.match(route, /completeProviderRuntimeRunSlot/);
    assert.match(route, /Run slot already consumed/);
    const gate = readFileSync("scripts/rls-context-acceptance-gate.mjs", "utf8");
    assert.match(gate, /AND deployment_id = \$3[\s\S]*AND commit_sha = \$4/);
    assert.match(gate, /AND deployment_id = \$4[\s\S]*AND commit_sha = \$5/);
    assert.doesNotMatch(route, /RLS_CONTEXT_GATE_ADMIN_DATABASE_URL|DIRECT_URL/);
    assert.doesNotMatch(route, /RLS_CONTEXT_GATE_PREPARE|RLS_CONTEXT_GATE_ROLLBACK_PROBE/);
  });

  it("returns only sanitized candidate evidence plus a non-secret run-id digest", () => {
    assert.match(route, /buildEvidencePayload/);
    assert.match(route, /completeProviderRuntimeRunSlot\(config, \{\s*evidence,/);
    assert.match(route, /runIdSha256: digest\(runId\)\.toString\(["']hex["']\)/);
    assert.doesNotMatch(route, /databaseUrl|adminDatabaseUrl|connectionString/);
  });

  it("exempts only the exact runner path from Clerk session middleware", () => {
    assert.match(middleware, /["']\/api\/internal\/rls-context-gate["']/);
    assert.doesNotMatch(middleware, /["']\/api\/internal\(\.\*\)["']/);
  });
});
