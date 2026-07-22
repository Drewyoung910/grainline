// RLS_CONTEXT_GATE_RUNNER_ONLY_TEST
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  RLS_CONTEXT_GATE_PUBLIC_PATH,
  RLS_CONTEXT_GATE_ROUTE_PATH,
  RLS_CONTEXT_GATE_RUNNER_TEST_PATH,
  validateCurrentSavedSearchRlsDeployShape,
} from "../scripts/guard-saved-search-rls-deploy.mjs";

describe("temporary Preview-only RLS context runner", () => {
  const route = readFileSync(RLS_CONTEXT_GATE_ROUTE_PATH, "utf8");
  const middleware = readFileSync("src/middleware.ts", "utf8");

  it("is preview-only, token-protected, commit-pinned, and DB-digest pinned", () => {
    assert.match(route, /process\.env\.VERCEL_ENV !== "preview"/);
    assert.match(route, /timingSafeEqual\(digest\(provided\), digest\(expected!\)\)/);
    assert.match(route, /allowedCommitSha === process\.env\.VERCEL_GIT_COMMIT_SHA/);
    assert.match(route, /timingSafeEqual\(digest\(applicationUrl!\), digest\(gateUrl!\)\)/);
    assert.match(route, /Cache-Control": "no-store, private"/);
    assert.match(route, /token: z\.string\(\)\.min\(32\)\.max\(256\)/);
    assert.match(middleware, new RegExp(RLS_CONTEXT_GATE_PUBLIC_PATH.replaceAll("/", "\\/")));
  });

  it("copies only runtime-safe repeat inputs and consumes slots durably", () => {
    const gateEnv = route.slice(route.indexOf("const gateEnv"), route.indexOf("try {", route.indexOf("const gateEnv")));
    assert.match(gateEnv, /RLS_CONTEXT_GATE_DATABASE_URL/);
    assert.doesNotMatch(gateEnv, /ADMIN_DATABASE_URL|EVIDENCE_PATH|PREPARE|ROLLBACK|TEARDOWN/);
    const claim = route.indexOf("await claimProviderRuntimeRunSlot");
    const run = route.indexOf("await runAcceptanceGate");
    const complete = route.indexOf("await completeProviderRuntimeRunSlot");
    assert.ok(claim >= 0 && run > claim && complete > run);
    assert.match(route, /runSlot: z\.union\(\[z\.literal\(1\), z\.literal\(2\)\]\)/);
    assert.match(route, /Run slot already consumed/);
    assert.match(route, /failed before sanitized evidence was available/);
  });

  it("keeps the production deploy guard fail-closed while runner artifacts exist", () => {
    assert.throws(
      () => validateCurrentSavedSearchRlsDeployShape({ phase: "phase-b-reviewed" }),
      (error) => {
        assert.match(error.message, new RegExp(RLS_CONTEXT_GATE_ROUTE_PATH.replaceAll("/", "\\/")));
        assert.match(error.message, new RegExp(RLS_CONTEXT_GATE_RUNNER_TEST_PATH.replaceAll("/", "\\/")));
        assert.match(error.message, new RegExp(RLS_CONTEXT_GATE_PUBLIC_PATH.replaceAll("/", "\\/")));
        return true;
      },
    );
  });
});
