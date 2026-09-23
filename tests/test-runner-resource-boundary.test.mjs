import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("full-suite test files have a fixed concurrency bound without excluding any tests", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(scripts.test,
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types --test --test-concurrency=1 tests/*.test.mjs");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const start = workflow.indexOf("      - name: Tests\n");
  const end = workflow.indexOf("      - name: Security audit\n", start);
  assert.ok(start > 0 && end > start);
  const step = workflow.slice(start, end);
  assert.match(step, /os\.availableParallelism\(\)/u);
  assert.match(step, /os\.totalmem\(\)/u);
  assert.match(step, /testFileConcurrency: 1/u);
  assert.match(step, /\n          npm test\s*$/u);
});
