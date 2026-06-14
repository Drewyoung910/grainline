import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("public fee-policy copy", () => {
  it("keeps public fee and refund copy aligned with the manual transfer model", () => {
    const termsState = source("src/lib/termsAcceptance.ts");
    const terms = source("src/app/terms/page.tsx");
    const handbook = source("src/app/seller-handbook/page.tsx");
    const whySell = source("src/app/why-sell-on-grainline/page.tsx");
    const checkoutAmounts = source("src/lib/checkoutAmounts.ts");
    const claude = source("CLAUDE.md");

    assert.match(termsState, /CURRENT_TERMS_VERSION = "2026-06-14"/);
    assert.match(terms, /Last Updated: June 14, 2026/);
    assert.match(checkoutAmounts, /sellerTransferBeforeMinimumCents = preTaxTotalCents - platformFeeCents/);
    assert.doesNotMatch(checkoutAmounts, /stripe|processing/i);

    assert.match(terms, /payment processing fees are\s+paid by Grainline/);
    assert.match(terms, /not separately deducted from Maker payouts/);
    assert.match(terms, /excluding shipping, gift wrapping, and taxes/);
    assert.match(terms, /gift wrapping is not included in the platform-fee base/);
    assert.match(terms, /waives\s+the corresponding platform-fee portion on the refunded amount/);
    assert.doesNotMatch(terms, /platform fee is\s+not refunded/);
    assert.doesNotMatch(terms, /gift wrapping[\s\S]{0,220}subject to the same platform\s+fee as the underlying item/);
    assert.doesNotMatch(terms, /not refunded to the Maker/);
    assert.doesNotMatch(terms, /after deduction of the platform fee and\s+Stripe/);

    assert.match(handbook, /absorbed by Grainline under our payout model/);
    assert.match(handbook, /sale price minus the 5% Grainline fee\)/);
    assert.match(handbook, /We waive our fee on refunded amounts/);
    assert.doesNotMatch(handbook, /minus Stripe processing/);
    assert.doesNotMatch(handbook, /non-refundable \(their policy, not ours\)/);

    assert.match(whySell, /Grainline currently absorbs it/);
    assert.match(whySell, /\$62\.50 before tax or refund\s+adjustments/);
    assert.match(whySell, /Stripe processing is absorbed\s+by Grainline under our payout model/);
    assert.doesNotMatch(whySell, /platform fees on top of Stripe/);
    assert.doesNotMatch(whySell, /nets you about \$61/);
    assert.doesNotMatch(whySell, /after our 5% and Stripe\s+processing/);
    assert.match(claude, /must not say Stripe processing fees are deducted from maker payouts/);
    assert.match(claude, /gift wrapping is included in the platform-fee base/);
  });
});
