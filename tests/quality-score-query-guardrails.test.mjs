import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("quality score query guardrails", () => {
  it("does not let blocked, banned, or deleted favorite users boost listings", () => {
    const qualityScore = source("src/lib/quality-score.ts");
    const authority = source(
      "prisma/migrations/20261007040000_prepare_user_follower_authorities/migration.sql",
    );

    assert.match(qualityScore, /userPublicListingFavoriteCounts\(prisma, listingIds\)/);
    assert.doesNotMatch(qualityScore, /JOIN "User"|FROM "User"/);
    assert.match(authority, /JOIN public\."User" AS favoriter/);
    assert.match(authority, /favoriter\.banned = false/);
    assert.match(authority, /favoriter\."deletedAt" IS NULL/);
    assert.match(authority, /FROM public\."Block" AS blocked_pair/);
    assert.match(authority, /blocked_pair\."blockerId" = favoriter\.id/);
    assert.match(authority, /blocked_pair\."blockedId" = seller\."userId"/);
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
