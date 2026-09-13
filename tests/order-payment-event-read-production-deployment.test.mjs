import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const release = readFileSync(
  "docs/order-payment-event-read-authority.md",
  "utf8",
);
const audit = readFileSync(
  "docs/order-payment-event-pre-rls-audit.md",
  "utf8",
);
const matrix = readFileSync("docs/rls-coverage-matrix.md", "utf8");

describe("OrderPaymentEvent compatible fixed-read production deployment", () => {
  it("pins the exact source, CI, deployment and canonical health boundary", () => {
    assert.match(release, /07eb9fc57bcec4d2fbac4d9ffc58b814ff78f5a8/);
    assert.match(release, /33297246142/);
    assert.match(release, /dpl_7UeENeZebXL9yL481DWrXkDpWd4R/);
    assert.match(release, /grainline-iji9ggah6-drew-youngs-projects\.vercel\.app/);
    assert.match(release, /all four canonical aliases|thegrainline\.com[\s\S]*www\.thegrainline\.com[\s\S]*grainline\.vercel\.app/);
    assert.match(release, /`\{"ok":true\}`/);
    assert.match(release, /grainline_app_runtime/);
  });

  it("records the CLI reporting failure without authorizing a duplicate deployment", () => {
    assert.match(release, /final API fetch[\s\S]*`deploy_failed`/);
    assert.match(release, /No retry was issued/);
    assert.match(release, /transport\/reporting failure/);
    assert.match(release, /dpl_2WkGbkiDdD8ySQYnCTur7ND3n2kd[\s\S]*remains READY/);
  });

  it("keeps compatible deployment distinct from activation", () => {
    for (const document of [release, audit, matrix]) {
      const normalized = document.replace(/\s+/gu, " ");
      assert.match(document, /07eb9fc57bcec4d2fbac4d9ffc58b814ff78f5a8/);
      assert.match(document, /dpl_7UeENeZebXL9yL481DWrXkDpWd4R/);
      assert.match(document, /RLS remains off/i);
      assert.match(
        normalized,
        /predecessor.*(?:CRUD|runtime table CRUD).*(?:retain|remain(?:s)? intact)/i,
      );
    }
    assert.match(release, /not RLS activation evidence/i);
  });
});
