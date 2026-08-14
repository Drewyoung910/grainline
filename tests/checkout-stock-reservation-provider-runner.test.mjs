// RLS_CONTEXT_GATE_RUNNER_ONLY_TEST
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  RLS_CONTEXT_GATE_PUBLIC_PATH,
  RLS_CONTEXT_GATE_ROUTE_PATH,
  validateCurrentSavedSearchRlsDeployShape,
} from "../scripts/guard-saved-search-rls-deploy.mjs";

const route = readFileSync(RLS_CONTEXT_GATE_ROUTE_PATH, "utf8");
const gate = readFileSync("src/lib/checkoutStockReservationProviderGate.ts", "utf8");
const middleware = readFileSync("src/middleware.ts", "utf8");
const publicInventory = readFileSync("tests/public-api-auth-inventory.test.mjs", "utf8");

describe("temporary CheckoutStockReservation provider runner", () => {
  it("is preview-only, secret-protected and commit/database pinned", () => {
    assert.match(route, /process\.env\.VERCEL_ENV !== "preview"/);
    assert.match(route, /timingSafeEqual\(digest\(provided\), digest\(expected!\)\)/);
    assert.match(route, /allowedCommitSha === process\.env\.VERCEL_GIT_COMMIT_SHA/);
    assert.match(route, /Boolean\(applicationUrl\) && !unsupportedGateAlias/);
    assert.match(route, /RLS_CONTEXT_GATE_DATABASE_URL: process\.env\.DATABASE_URL/);
    assert.match(route, /Cache-Control": "no-store, private"/);
    assert.match(route, /runSlot: z\.union\(\[z\.literal\(1\), z\.literal\(2\)\]\)/);
    assert.match(middleware, new RegExp(RLS_CONTEXT_GATE_PUBLIC_PATH.replaceAll("/", "\\/")));
    assert.match(publicInventory, /CHECKOUT_STOCK_RESERVATION_PROVIDER_RUNNER_ONLY/);
  });

  it("copies no owner/setup authority and durably consumes each run slot", () => {
    const envStart = route.indexOf("const gateEnv");
    const envEnd = route.indexOf("try {", envStart);
    const gateEnv = route.slice(envStart, envEnd);
    assert.match(gateEnv, /RLS_CONTEXT_GATE_DATABASE_URL: process\.env\.DATABASE_URL/);
    assert.doesNotMatch(gateEnv, /ADMIN_DATABASE_URL|EVIDENCE_PATH|PREPARE|ROLLBACK|TEARDOWN/);
    const claim = route.indexOf("await claimProviderRuntimeRunSlot");
    const run = route.indexOf("await runCheckoutStockReservationProviderGate");
    const complete = route.indexOf("await completeProviderRuntimeRunSlot");
    assert.ok(claim >= 0 && run > claim && complete > run);
    assert.match(route, /Run slot already consumed/);
    assert.match(route, /failed before sanitized evidence was available/);
  });

  it("exercises the actual atomic candidate and explicit concurrency contracts", () => {
    const candidateStart = gate.indexOf("async function runCandidate");
    const candidateEnd = gate.indexOf("function evaluateCandidate", candidateStart);
    const candidate = gate.slice(candidateStart, candidateEnd);
    assert.ok(candidateStart >= 0 && candidateEnd > candidateStart);
    assert.match(gate, /createConsistentSingleCheckoutStockReservation\(/);
    assert.match(gate, /singleCheckoutReservationSourceWitness\(/);
    assert.doesNotMatch(candidate, /lockCheckoutReservationSellerSource\(tx,/);
    assert.doesNotMatch(candidate, /checkoutReservationInventorySourceMatches\(/);
    assert.doesNotMatch(candidate, /prisma\.\$transaction\(async \(tx\) =>/);
    assert.match(gate, /same_seller_different_listing_target/);
    assert.match(gate, /same_seller_different_listing_burst/);
    assert.match(gate, /proveBoundedSameListingWait/);
    assert.match(gate, /candidate\.p95Ms > 750/);
    assert.match(gate, /candidate\.maxMs > 3_000/);
    assert.match(gate, /after\.activeReservations !== 0/);
  });

  it("cannot pass a production release guard while proof artifacts remain", () => {
    assert.throws(
      () => validateCurrentSavedSearchRlsDeployShape({
        phase: "checkout-stock-reservation-authority-reviewed",
      }),
      /temporary context-gate app artifact/,
    );
    assert.match(route, /provider-runtime-checkout-reservation-candidate/);
    const releaseGuard = readFileSync("scripts/guard-saved-search-rls-deploy.mjs", "utf8");
    assert.match(releaseGuard, /temporary context-gate app artifact/);
    assert.match(releaseGuard, /assertProductionArtifactExcludesContextGate/);
  });
});
