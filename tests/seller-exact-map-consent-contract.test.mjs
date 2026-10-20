import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  exactMapConsentBinding,
  exactMapConsentBindingMatches,
  SELLER_EXACT_MAP_CONSENT_TEXT,
  SELLER_EXACT_MAP_CONSENT_TEXT_SHA256,
  SELLER_EXACT_MAP_CONSENT_VERSION,
} from "../src/lib/sellerExactMapConsent.ts";

test("exact-map consent text and version stay bound to reviewed evidence", () => {
  assert.equal(SELLER_EXACT_MAP_CONSENT_VERSION, 1);
  assert.equal(
    crypto.createHash("sha256").update(SELLER_EXACT_MAP_CONSENT_TEXT).digest("hex"),
    SELLER_EXACT_MAP_CONSENT_TEXT_SHA256,
  );
});

test("moving a pin invalidates the exact-map consent binding", () => {
  const binding = exactMapConsentBinding(true, 30.251, -97.749);
  assert.equal(exactMapConsentBindingMatches(binding, 30.251, -97.749), true);
  assert.equal(exactMapConsentBindingMatches(binding, 30.252, -97.749), false);
  assert.equal(exactMapConsentBinding(false, 30.251, -97.749), null);
});
