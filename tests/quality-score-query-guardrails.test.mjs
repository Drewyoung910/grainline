import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("quality score query guardrails", () => {
  it("does not let blocked, banned, or deleted favorite users boost listings", () => {
    const qualityScore = source("src/lib/quality-score.ts");

    assert.match(qualityScore, /JOIN "User" fu ON fu\.id = f\."userId"/);
    assert.match(qualityScore, /fu\.banned = false/);
    assert.match(qualityScore, /fu\."deletedAt" IS NULL/);
    assert.match(qualityScore, /FROM "Block" b/);
    assert.match(qualityScore, /b\."blockerId" = fu\.id AND b\."blockedId" = sp\."userId"/);
    assert.match(qualityScore, /b\."blockerId" = sp\."userId" AND b\."blockedId" = fu\.id/);
  });

  it("excludes open, lost, and unknown Stripe disputes from quality and site conversion counts", () => {
    for (const path of ["src/lib/quality-score.ts", "src/lib/site-metrics-snapshot.ts"]) {
      const text = source(path);

      assert.match(text, /ope\."eventType" = 'DISPUTE'/, `${path} must inspect dispute ledger rows`);
      assert.match(
        text,
        /LOWER\(ope\.status\) NOT IN \('won', 'warning_closed'\)/,
        `${path} must count only won or warning-closed Stripe disputes as conversion signal`,
      );
      assert.doesNotMatch(text, /'won', 'lost', 'warning_closed'/);
    }
  });
});
