import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

describe("checkout script inventory", () => {
  it("keeps the documented checkout script inventory aligned with Stripe checkout code", () => {
    const doc = source("docs/checkout-script-inventory.md");
    const embeddedCheckout = source("src/components/EmbeddedCheckoutPanel.tsx");

    assert.match(embeddedCheckout, /import \{ loadStripe \} from "@stripe\/stripe-js"/);
    assert.match(embeddedCheckout, /const stripePromise = loadStripe/);
    assert.match(embeddedCheckout, /<EmbeddedCheckoutProvider/);
    assert.match(embeddedCheckout, /<EmbeddedCheckout \/>/);

    assert.match(doc, /https:\/\/js\.stripe\.com/);
    assert.match(doc, /src\/components\/EmbeddedCheckoutPanel\.tsx/);
    assert.match(doc, /Do not self-host or bundle/);
    assert.match(doc, /Do not add stale SRI hashes/);
  });

  it("documents covered checkout surfaces and change-control rules", () => {
    const doc = source("docs/checkout-script-inventory.md");

    assert.match(doc, /\/cart/);
    assert.match(doc, /\/listing\/\[id\]/);
    assert.match(doc, /\/checkout\/success/);
    assert.match(doc, /Any new third-party script, iframe, analytics tool, tag manager/);
    assert.match(doc, /Do not add wildcard script\/frame\/connect hosts/);
  });

  it("keeps checkout surfaces free of direct next/script usage", () => {
    const files = [
      "src/app/cart/page.tsx",
      "src/components/BuyNowCheckoutModal.tsx",
      "src/components/EmbeddedCheckoutPanel.tsx",
      "src/app/checkout/success/page.tsx",
    ];

    for (const file of files) {
      assert.doesNotMatch(source(file), /from "next\/script"|<Script\b/, `${file} should not add direct scripts`);
    }
  });

  it("keeps Buy Now from loading Stripe.js before the payment step", () => {
    const modal = source("src/components/BuyNowCheckoutModal.tsx");

    assert.match(modal, /dynamic\(\(\) => import\("\.\/EmbeddedCheckoutPanel"\)/);
    assert.doesNotMatch(modal, /import EmbeddedCheckoutPanel from "\.\/EmbeddedCheckoutPanel"/);
  });

  it("keeps the security plan and launch checklist pointed at the inventory", () => {
    assert.match(source("docs/security-hardening-plan.md"), /docs\/checkout-script-inventory\.md/);
    assert.match(source("docs/launch-checklist.md"), /docs\/checkout-script-inventory\.md/);
  });
});
