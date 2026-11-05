import assert from "node:assert/strict";
import test from "node:test";
import { checkoutRouteFixture as fixture } from "./helpers/checkout-route-fixture.mjs";

for (const [label, path] of [
  ["Buy Now", "src/app/api/cart/checkout/single/route.ts"],
  ["cart", "src/app/api/cart/checkout-seller/route.ts"],
]) {
  test(`${label}: a buyer over the allowance reserves no stock`, async () => {
    const subject = fixture(path, { capped: true });
    const response = await subject.post();
    assert.equal(response.status, 429);
    assert.equal(subject.state.reservations, 0);
  });

  test(`${label}: a buyer inside the allowance reserves stock`, async () => {
    const subject = fixture(path);
    const response = await subject.post();
    assert.equal(response.status, 200);
    assert.equal(subject.state.capChecks, 1);
    assert.equal(subject.state.reservations, 1);
  });

  test(`${label}: made-to-order holds no stock, so it spends no allowance`, async () => {
    const subject = fixture(path, { listingType: "MADE_TO_ORDER", capped: true });
    const response = await subject.post();
    assert.equal(response.status, 200);
    assert.equal(subject.state.capChecks, 0);
  });
}
