import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load } from "js-yaml";

test("full-suite test files have a fixed concurrency bound without excluding any tests", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(scripts.test,
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test --test-concurrency=1 tests/*.test.mjs");
  const { jobs } = load(readFileSync(".github/workflows/ci.yml", "utf8"));
  const steps = jobs.check.steps;
  const testSteps = steps.filter(({ name }) => name === "Tests");
  assert.equal(testSteps.length, 1);
  const step = testSteps[0].run;
  assert.match(step, /os\.availableParallelism\(\)/u);
  assert.match(step, /os\.totalmem\(\)/u);
  assert.match(step, /testFileConcurrency: 1/u);
  assert.match(step, /\nnpm test\s*$/u);
  const guardIndex = steps.findIndex(({ name }) => name === "Verify CI resource and dependency guards");
  assert.ok(guardIndex > steps.findIndex(({ run }) => run === "npm ci --ignore-scripts"));
  assert.ok(guardIndex < steps.findIndex(({ run }) => run === "npx prisma generate"));
  assert.match(steps[guardIndex].run, /tests\/test-runner-resource-boundary\.test\.mjs/u);
  assert.match(steps[guardIndex].run, /tests\/dependency-hygiene\.test\.mjs/u);
});
