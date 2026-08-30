import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const release = readFileSync(
  "docs/order-payment-event-transition-authority.md",
  "utf8",
);
const matrix = readFileSync("docs/rls-coverage-matrix.md", "utf8");
const auditLog = readFileSync("docs/security-audit-log.md", "utf8");

const documents = [release, matrix, auditLog];

describe("OrderPaymentEvent transition production smoke record", () => {
  it("pins the reviewed package, exact main CI and sanitized evidence", () => {
    for (const document of documents) {
      assert.match(document, /32814fa7d73171ff79b0d4d26584a054e8b2bb7d/);
      assert.match(document, /df9997795ceb3163247052cabacb6feb095918c8/);
      assert.match(document, /33329781065/);
      assert.match(document, /33329293870/);
      assert.match(
        document,
        /9d0eacbf1062d8f2b370655d91e1f0e817a4a44edf4456d71a31c578cb07ab11/,
      );
    }
  });

  it("records the current and preserved predecessor deployments", () => {
    for (const document of documents) {
      assert.match(document, /dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc/);
      assert.match(document, /dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj/);
    }
  });

  it("keeps compatibility evidence and RLS activation boundaries honest", () => {
    for (const document of documents) {
      const normalized = document.replace(/\s+/gu, " ");
      assert.match(normalized, /(?:zero|created zero).*fixture/i);
      assert.match(normalized, /RLS remains off/i);
      assert.match(normalized, /predecessor.*CRUD.*retain/i);
      assert.match(normalized, /predecessor drain.*zero-direct-access/i);
    }
    assert.match(
      release.replace(/\s+/gu, " "),
      /transition routes are not directly exercised/i,
    );
    assert.match(
      auditLog.replace(/\s+/gu, " "),
      /did not directly exercise transition routes/i,
    );
  });
});
