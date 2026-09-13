import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const strategy = await readFile(new URL("../STRATEGY.md", import.meta.url), "utf8");
const record = await readFile(
  new URL("../docs/repository-worktree-reconciliation-20260831.md", import.meta.url),
  "utf8",
);

test("records the completed repository reconciliation without importing raw audit material", () => {
  assert.match(strategy, /Repository reconciliation complete; Preview hygiene deferred/);
  assert.match(strategy, /normal repository root now\s+tracks that exact clean `main`/);
  assert.match(record, /All completion requirements were reverified/);
  assert.match(record, /raw,\s+unreviewed Claude audit imports/);
  assert.match(record, /does not change application\s+code, database state, Vercel state, credentials or provider configuration/);
  assert.doesNotMatch(record, /### NEW FINDINGS/);
});
