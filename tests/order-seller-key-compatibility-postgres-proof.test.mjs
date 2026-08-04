import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  parseOrderSellerKeyCompatibilityProofConfig,
  readOrderSellerKeyDraftBody,
} from "../scripts/order-seller-key-compatibility-postgres-proof.mjs";

const draft = fs.readFileSync(
  "docs/rls-drafts/order-seller-key-compatibility.sql",
  "utf8",
);
const proof = fs.readFileSync(
  "scripts/order-seller-key-compatibility-postgres-proof.mjs",
  "utf8",
);
const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("Order seller-key proof refuses persistent database targets", () => {
  assert.throws(
    () => parseOrderSellerKeyCompatibilityProofConfig({}),
    /ORDER_SELLER_KEY_COMPATIBILITY_PROOF_DATABASE_URL is required/,
  );
  assert.throws(
    () => parseOrderSellerKeyCompatibilityProofConfig({
      ORDER_SELLER_KEY_COMPATIBILITY_PROOF_DATABASE_URL:
        "postgresql://ci:ci@database.example/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseOrderSellerKeyCompatibilityProofConfig({
      ORDER_SELLER_KEY_COMPATIBILITY_PROOF_DATABASE_URL:
        "postgresql://ci:ci@127.0.0.1/production",
    }),
    /requires the grainline_ci database/,
  );
});

test("Order seller-key draft remains rollback-only and production-gated", () => {
  const body = readOrderSellerKeyDraftBody();
  assert.match(draft, /DRAFT ONLY/);
  assert.match(draft, /not a production migration/);
  assert.doesNotMatch(body, /^\s*BEGIN;/m);
  assert.doesNotMatch(body, /^\s*COMMIT;/m);
  assert.match(proof, /await client\.query\("BEGIN"\)/);
  assert.match(proof, /await client\.query\("ROLLBACK"\)/);
  assert.match(proof, /persistentStagingChanged: false/);
  assert.match(proof, /productionChanged: false/);
  assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
});

test("candidate aborts instead of guessing ambiguous legacy sellers", () => {
  assert.match(draft, /order_without_item_count/);
  assert.match(draft, /order_multi_seller_count/);
  assert.match(draft, /zero-item order/);
  assert.match(draft, /multi-seller order/);
  assert.match(proof, /provePreflightRejects\(client, draftBody, "zero-item"\)/);
  assert.match(proof, /provePreflightRejects\(client, draftBody, "multi-seller"\)/);
});

test("candidate binds both rows to the durable seller under an Order lock", () => {
  assert.match(draft, /ADD COLUMN "sellerProfileId" text/);
  assert.match(
    draft,
    /FOREIGN KEY \("orderId", "sellerProfileId"\)[\s\S]*REFERENCES public\."Order"\(id, "sellerProfileId"\)/,
  );
  assert.match(
    draft,
    /FOREIGN KEY \("listingId", "sellerProfileId"\)[\s\S]*REFERENCES public\."Listing"\(id, "sellerId"\)/,
  );
  assert.match(
    draft,
    /SELECT orders\."sellerProfileId"[\s\S]*FOR UPDATE;/,
  );
  assert.match(draft, /OrderItem authority keys are immutable/);
  assert.match(draft, /Order cannot contain items from multiple sellers/);
});

test("candidate enforces complete Orders at the transaction boundary", () => {
  assert.match(draft, /CREATE CONSTRAINT TRIGGER grainline_order_seller_key_complete/);
  assert.match(draft, /CREATE CONSTRAINT TRIGGER grainline_order_item_seller_key_complete/);
  assert.match(draft, /DEFERRABLE INITIALLY DEFERRED/g);
  assert.match(proof, /"zero_item_order"/);
  assert.match(proof, /"delete_last_item"/);
  assert.match(proof, /SET CONSTRAINTS ALL IMMEDIATE/);
});

test("all trigger helpers are private pinned SECURITY DEFINER functions", () => {
  assert.equal((draft.match(/SECURITY DEFINER/g) ?? []).length, 4);
  assert.equal((draft.match(/SET search_path = pg_catalog/g) ?? []).length, 4);
  assert.equal((draft.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 4);
  assert.doesNotMatch(draft, /\bEXECUTE\s+(?:format|immediate)\b/i);
  assert.match(proof, /private_function_count: 4/);
});

test("proof covers old app, new app, forgery and ownership drift", () => {
  for (const marker of [
    "old-app",
    "new-app",
    "forged_item_seller",
    "cross_seller_item",
    "authority_key_rebinding",
    "purchased_listing_seller_rebinding",
  ]) {
    assert.match(proof, new RegExp(marker.replaceAll("-", "[-_]")), marker);
  }
  assert.match(proof, /checks: 12/);
});

test("CI runs the exact rollback-only PostgreSQL proof", () => {
  assert.equal(
    packageJson.scripts["audit:rls-order-seller-key-compatibility"],
    "node scripts/order-seller-key-compatibility-postgres-proof.mjs",
  );
  assert.match(
    workflow,
    /Prove compatible Order seller key in rollback-only PostgreSQL[\s\S]*npm run audit:rls-order-seller-key-compatibility[\s\S]*ORDER_SELLER_KEY_COMPATIBILITY_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
  );
});
