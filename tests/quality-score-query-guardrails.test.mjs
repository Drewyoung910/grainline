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
    const publicAggregateAuthority = source(
      "prisma/migrations/20260901050000_prepare_order_public_aggregate_authority/migration.sql",
    );
    for (const path of ["src/lib/quality-score.ts", "src/lib/site-metrics-snapshot.ts"]) {
      const text = source(path);

      assert.match(
        text,
        /orderPublicAggregateAuthority|getPublic/,
        `${path} must use the database-maintained conversion-dispute projection`,
      );
      assert.doesNotMatch(
        text,
        /latestConversionBlockingDisputeLedgerExistsSql|FROM "OrderPaymentEvent" ope|LOWER\(ope\.status\)/,
      );
    }
    assert.match(publicAggregateAuthority, /source_order\."paymentConversionDisputeBlocked" = false/u);

    const migration = source(
      "prisma/migrations/20260830010000_prepare_order_payment_event_aggregate_authority/migration.sql",
    );
    assert.match(migration, /'won', 'warning_closed'/);
    assert.match(migration, /count\(DISTINCT pg_catalog\.jsonb_build_array/);
    assert.match(migration, /max\([\s\S]*"stripeEventCreatedSeconds"/);
    assert.doesNotMatch(migration, /SELECT DISTINCT ON/);
  });
});
