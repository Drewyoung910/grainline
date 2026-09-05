import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(path, "utf8");

describe("Order Stripe webhook authority design", () => {
  const design = read("docs/order-stripe-webhook-authority.md");

  it("keeps provider authentication in the route and row authority in fixed operations", () => {
    assert.match(design, /PostgreSQL does not verify Stripe signatures/);
    assert.match(design, /active event ID,[\s\S]*generation[\s\S]*source-object tuple/);
    assert.match(design, /must derive user, seller,[\s\S]*OrderItem relationships itself/);
    assert.match(design, /must not expose a generic review-note writer/);
  });

  it("preserves the complete locked checkout source for every new listing type", () => {
    assert.match(design, /sourceSnapshot/);
    assert.match(design, /existing locked function accept it[\s\S]*private[\s\S]*helper independently rebuilds/);
    assert.match(design, /description, category, tags, every ordered photo URL/);
    assert.match(design, /original 1-MiB candidate bound was insufficient/);
    assert.match(design, /source-only reservation with\s+`reservedItems = \[\]` for[\s\S]*made-to-order/);
    assert.match(design, /do not replace predecessor functions in place/);
    assert.match(design, /application candidate now calls only the two versioned snapshot\s+functions/);
    assert.match(design, /Do not deploy this candidate until the nullable\s+column and successor functions exist/);
  });

  it("makes seller deauthorization explicit, complete and replayable", () => {
    assert.match(design, /already-held open Order never receives durable deauthorization state/);
    assert.match(design, /replay cannot rediscover[\s\S]*seller/);
    assert.match(design, /sellerDeauthorizedAt/);
    assert.match(design, /mark every open Order/);
    assert.match(design, /regardless of an existing\s+review hold/);
    assert.match(design, /Reauthorization does not silently clear historical Order deauthorization/);
    assert.match(design, /single generation-bound operation/);
    assert.match(design, /explicitly UTC-normalized/);
    assert.match(design, /deliberately not deployable yet/);
  });

  it("records the proven paid-order boundary without claiming conversion", () => {
    assert.match(design, /exact 36-key provider projection/);
    assert.match(design, /single-listing and cart checkout/);
    assert.match(design, /duplicate retained source keys/);
    assert.match(design, /single in-stock orders preserve the existing one-day minimum/);
    assert.match(design, /forced downstream completion failure/);
    assert.match(design, /This is not yet the application conversion/);
  });

  it("keeps Order, OrderItem and quote activation as separate releases", () => {
    assert.match(design, /Order activation remains separate from later `OrderItem` and[\s\S]*`OrderShippingRateQuote` activation/);
    assert.match(design, /read-only inspection,[\s\S]*Phase A,[\s\S]*then FORCE/);
    assert.match(design, /No provider proof or RLS activation is implied by the local work/);
  });
});
