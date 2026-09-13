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

describe("OrderPaymentEvent transition compatible production deployment", () => {
  it("pins the exact source, CI, migration and deployment identity", () => {
    for (const document of documents) {
      assert.match(document, /ce7550dae6c417440230f4d596f2239393075f31/);
      assert.match(document, /33327064035/);
      assert.match(document, /33326252495/);
      assert.match(document, /dpl_Coyjd6rTXteBV9e4QZtZGFDaiEYc/);
      assert.match(document, /READY/);
    }
    assert.match(
      release,
      /grainline-ees25wgos-drew-youngs-projects\.vercel\.app/,
    );
  });

  it("records all canonical aliases and the accepted health response", () => {
    for (const alias of [
      "thegrainline.com",
      "www.thegrainline.com",
      "grainline.vercel.app",
      "grainline-drew-youngs-projects.vercel.app",
    ]) {
      assert.match(release, new RegExp(alias.replaceAll(".", "\\.")));
    }
    assert.match(release, /HTTP 200/);
    assert.match(release, /\{"ok":true\}/);
  });

  it("preserves the exact predecessor and keeps activation separate", () => {
    for (const document of documents) {
      const normalized = document.replace(/\s+/gu, " ");
      assert.match(document, /dpl_UiZckAkuj8CSyLPBeQBUHF5Fq1Dj/);
      assert.match(document, /RLS remains off/i);
      assert.match(normalized, /predecessor.*(?:CRUD|table CRUD).*retain/i);
    }
    assert.match(release, /was not drained/);
    assert.match(release, /policyless `ENABLE` and separate `FORCE`/);
  });
});
