import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ORDER_PAYMENT_SHIPPING_COMPATIBILITY_MIGRATION,
  buildOrderPaymentShippingCompatibilityCandidate,
} from "../scripts/stage-order-payment-shipping-compatible-preparation.mjs";
import {
  ORDER_PAYMENT_SHIPPING_COMPATIBILITY_PHASE,
  verifyOrderPaymentShippingCompatiblePreparation,
} from "../scripts/verify-order-payment-shipping-compatible-preparation.mjs";

const candidate = buildOrderPaymentShippingCompatibilityCandidate();
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const release = fs.readFileSync(
  "docs/order-payment-shipping-compatible-preparation-release.md",
  "utf8",
);
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("compatibility candidate is one additive transaction pinned to both drafts", () => {
  assert.equal(
    candidate.migrationName,
    "20260805012000_prepare_order_payment_shipping_compatibility",
  );
  assert.equal((candidate.migration.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((candidate.migration.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.match(candidate.migration, /ADD COLUMN "sellerProfileId" text/);
  assert.match(candidate.migration, /ADD COLUMN "claimGeneration" bigint NOT NULL DEFAULT 0/);
  assert.match(candidate.migration, /clock_timestamp\(\) AT TIME ZONE 'UTC'/);
  assert.doesNotMatch(candidate.migration, /DRAFT ONLY/);
  assert.doesNotMatch(candidate.migration, /not a production migration/);
});

test("compatibility candidate preserves predecessor grants and RLS posture", () => {
  assert.doesNotMatch(candidate.migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(candidate.migration, /FORCE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(
    candidate.migration,
    /(?:GRANT|REVOKE)[\s\S]{0,120}ON TABLE public\."(?:Order|OrderItem|StripeWebhookEvent)"/i,
  );
  assert.match(
    candidate.migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_stripe_webhook_begin\(text, text\)/,
  );
});

test("promoted migration, when present, is byte-identical to the candidate", () => {
  const migrationPath = path.join(
    "prisma",
    "migrations",
    ORDER_PAYMENT_SHIPPING_COMPATIBILITY_MIGRATION,
    "migration.sql",
  );
  if (!fs.existsSync(migrationPath)) return;
  assert.equal(fs.readFileSync(migrationPath, "utf8"), candidate.migration);
});

test("release verifier pins promoted bytes and the complete current tree", () => {
  const result = verifyOrderPaymentShippingCompatiblePreparation();
  assert.equal(result.phase, ORDER_PAYMENT_SHIPPING_COMPATIBILITY_PHASE);
  assert.equal(result.migrationName, candidate.migrationName);
  assert.equal(result.migrationSha256, candidate.migrationSha256);
  assert.equal(result.rlsChanged, false);
  assert.equal(result.predecessorTableGrantsChanged, false);
  assert.equal(
    packageJson.scripts?.[
      "audit:rls-order-payment-shipping-compatible-preparation"
    ],
    "node scripts/verify-order-payment-shipping-compatible-preparation.mjs",
  );
});

test("CI and production migration workflows fail closed on the exact release", () => {
  for (const workflow of [ci, production]) {
    const treeGuard = workflow.indexOf(
      "SAVED_SEARCH_RLS_DEPLOY_PHASE: stripe-webhook-maintenance-authority-reviewed",
    );
    const proof = workflow.indexOf(
      "npm run audit:rls-stripe-webhook-maintenance-authority",
    );
    const deploy = workflow.indexOf("npx prisma migrate deploy");
    assert.ok(treeGuard >= 0);
    assert.ok(proof > treeGuard);
    if (deploy >= 0) assert.ok(deploy > proof);
  }
});

test("release record preserves the non-activation boundary and proof history", () => {
  assert.match(release, new RegExp(candidate.migrationSha256));
  assert.match(release, /30964592546/);
  assert.match(release, /30965587927/);
  assert.match(release, /6f1f4c1e99fb21726744ecd1652a37b6be35c294/);
  assert.match(release, /31277540714/);
  assert.match(release, /a2348cd61fed8e3bf9f5ffc3cf1906c71cb4c45a0ec2325e90d117893c001809/);
  assert.match(release, /does \*\*not\*\* enable or FORCE RLS/i);
  assert.match(release, /does not authorize the remaining application merge/i);
});
