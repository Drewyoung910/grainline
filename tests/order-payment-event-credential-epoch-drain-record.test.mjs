import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mergeCommit = "6ce4932adaa4d6b651a2a902d8e731aaad08e259";
const ciRun = "33332817851";
const currentDeployment = "dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc";
const evidenceSha = "1596ad71479f7a9bda51b00c94b3ac27bea6adf6a5454eb34e03c35618764e5d";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

test("durable records accept the exact credential-epoch drain without overstating RLS", () => {
  const drain = read("docs/order-payment-event-credential-epoch-drain.md");
  const architecture = read("docs/architecture.md");
  const matrix = read("docs/rls-coverage-matrix.md");
  const strategy = read("STRATEGY.md");
  const audit = read("docs/security-audit-log.md");
  const combined = [drain, architecture, matrix, strategy, audit].join("\n");

  for (const expected of [mergeCommit, ciRun, currentDeployment, evidenceSha]) {
    assert.match(combined, new RegExp(expected));
  }
  assert.match(drain, /removed all 11 exact superseded deployments/i);
  assert.match(drain, /zero\s+shared-credential\s+predecessors/i);
  assert.match(drain, /RLS remains off with predecessor table CRUD retained/i);
  assert.match(drain, /makes no zero-direct-access claim/i);
  assert.match(matrix, /next gate is the[\s>]+separate exact-tree zero-direct-access proof/i);
  assert.match(strategy, /policyless ENABLE and FORCE remain later\s+separate gates/i);
});
