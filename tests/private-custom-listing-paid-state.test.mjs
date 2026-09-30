import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const predecessor = fs.readFileSync(
  "prisma/migrations/20260926011000_correct_order_paid_checkout_bound_reservation/migration.sql",
  "utf8",
);
const successor = fs.readFileSync(
  "prisma/migrations/20260930031000_mark_paid_private_listing_sold/migration.sql",
  "utf8",
);

const successorOnlyUpdate = `

    UPDATE public."Listing" AS listing
       SET status = 'SOLD'
     WHERE listing.id = source_listing_id
       AND listing."listingType" = 'MADE_TO_ORDER'
       AND listing."isPrivate"
       AND listing."reservedForUserId" = source_buyer_id
       AND listing.status = 'ACTIVE'
       AND source_invalid_reason = '';
    source_listing_visibility_changed := source_listing_visibility_changed OR FOUND;`;

function withoutHeader(sql) {
  return sql.replace(/^--[\s\S]*?\n\n(?=BEGIN;)/u, "");
}

describe("private custom listing paid state", () => {
  it("changes the paid-checkout authority only by adding the reviewed SOLD transition", () => {
    assert.match(successor, /Retire a successfully purchased private made-to-order listing/);
    assert.equal(successor.includes(successorOnlyUpdate), true);
    assert.equal(
      withoutHeader(successor).replace(successorOnlyUpdate, ""),
      withoutHeader(predecessor),
    );
  });

  it("keeps the paid custom listing visible but non-purchasable", () => {
    const visibility = fs.readFileSync("src/lib/listingVisibility.ts", "utf8");
    const listingPage = fs.readFileSync("src/app/listing/[id]/page.tsx", "utf8");
    const messages = fs.readFileSync("src/components/ThreadMessages.tsx", "utf8");

    assert.match(
      visibility,
      /listing\.status === ListingStatus\.ACTIVE \|\| listing\.status === ListingStatus\.SOLD/u,
    );
    assert.match(listingPage, /const isActive = listing\.status === "ACTIVE"/u);
    assert.match(listingPage, /const canBuy =[\s\S]*?isActive &&/u);
    assert.match(messages, />\s*View Custom Piece\s*</u);
    assert.doesNotMatch(messages, />\s*Purchase This Piece\s*</u);
  });
});
