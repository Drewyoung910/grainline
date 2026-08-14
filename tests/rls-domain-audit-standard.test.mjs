import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const agentContract = readFileSync("CLAUDE.md", "utf8");
const feasibilityPlan = readFileSync("docs/rls-feasibility-plan.md", "utf8");
const coverageMatrix = readFileSync("docs/rls-coverage-matrix.md", "utf8");

test("requires a separate product and authority audit before each RLS group", () => {
  assert.match(agentContract, /Pre-RLS domain audit gate/);
  assert.match(feasibilityPlan, /Required Domain Audit Before RLS Design/);

  for (const findingClass of [
    "BLOCKS_RLS_DESIGN",
    "FIX_BEFORE_ACTIVATION",
    "DEFERRED_PRODUCT_WORK",
  ]) {
    assert.match(agentContract, new RegExp(findingClass));
    assert.match(feasibilityPlan, new RegExp(findingClass));
    assert.match(coverageMatrix, new RegExp(findingClass));
  }

  for (const requiredConcept of [
    /operation-by-principal authority matrix/,
    /state machine/,
    /concurrency/,
    /idempotency/,
    /failure recovery/,
    /expected scale/,
    /go\/no-go/,
  ]) {
    assert.match(feasibilityPlan, requiredConcept);
  }

  assert.match(feasibilityPlan, /database denial[\s\S]*does not substitute/);
  assert.match(coverageMatrix, /A target disposition by itself is not approval/);
});
