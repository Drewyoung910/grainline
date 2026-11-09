import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const page = readFileSync("src/app/why-grainline/page.tsx", "utf8");

describe("Why Grainline claims", () => {
  it("describes enforced behavior without promising unverified identity or nationality", () => {
    assert.match(page, /Makers connect Stripe accounts/u);
    assert.match(page, /every listing is reviewed before it goes live/u);
    assert.match(page, /factory imports and resellers are prohibited/u);
    assert.match(page, /Payment account setup/u);
    assert.match(page, /approved to accept payments/u);

    assert.doesNotMatch(page, /anonymous shops/iu);
    assert.doesNotMatch(page, /verified identity/iu);
    assert.doesNotMatch(page, /real names/iu);
    assert.doesNotMatch(page, /identity verification/iu);
    assert.doesNotMatch(page, /shell accounts/iu);
    assert.doesNotMatch(page, /Every workshop is American/u);
    assert.doesNotMatch(page, /every seller on it ships from a US address/u);
    assert.doesNotMatch(page, /money goes straight to a US workshop/u);
    assert.doesNotMatch(page, /American craftspeople/u);
    assert.doesNotMatch(page, />50<\/div>[\s\S]*states shipped to/u);
    assert.doesNotMatch(page, /The maker has 48 hours to respond/u);
    assert.doesNotMatch(page, /staff make the final call and issue the refund/u);
    assert.doesNotMatch(page, /protected on every purchase/iu);
    assert.doesNotMatch(page, /binding decision/iu);

    assert.match(page, /For eligible orders, the order page explains when a case can be opened/u);
    assert.match(page, /Eligible unresolved cases can be escalated/u);
    assert.match(page, /If the decision includes a refund/u);
  });
});
