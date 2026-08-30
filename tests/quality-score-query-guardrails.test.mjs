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

  it("excludes open, lost, and unknown Stripe disputes through the fixed Order projection", () => {
    for (const path of ["src/lib/quality-score.ts", "src/lib/site-metrics-snapshot.ts"]) {
      const text = source(path);

      assert.match(
        text,
        /o\."paymentConversionDisputeBlocked" = false/,
        `${path} must use the database-maintained conversion-dispute projection`,
      );
      assert.doesNotMatch(
        text,
        /latestConversionBlockingDisputeLedgerExistsSql|FROM "OrderPaymentEvent" ope|LOWER\(ope\.status\)/,
      );
    }

    const helper = source("src/lib/refundLedgerSql.ts");
    assert.match(helper, /QUALIFYING_CONVERSION_DISPUTE_STATUSES = \[\s*"won",\s*"warning_closed",/);
    assert.match(helper, /latestConversionBlockingDisputeLedgerExistsSql/);
    assert.match(helper, /latestDisputeLedgerRowsSql/);
    assert.match(helper, /SELECT DISTINCT ON \(COALESCE\(ope\."stripeObjectId", ope\.id\)\)/);
  });
});
