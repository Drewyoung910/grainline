import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const audit = fs.readFileSync("docs/stripe-webhook-event-activation-audit.md", "utf8");
const buyerProof = fs.readFileSync("scripts/buyer-deletion-stripe-replay-proof.mjs", "utf8");
const launchChecklist = fs.readFileSync("docs/launch-checklist.md", "utf8");
const signedRouteSources = Object.freeze([
  "src/app/api/stripe/webhook/route.ts",
  "src/app/api/stripe/webhook/connect/route.ts",
  "src/app/api/stripe/webhook/v2/route.ts",
].map((file) => Object.freeze({
  file,
  source: fs.readFileSync(file, "utf8"),
})));
const directAccess = /\b(?:prisma|tx|client)\.stripeWebhookEvent\b|(?:FROM|JOIN|UPDATE|INTO|TABLE|DELETE\s+FROM)\s+(?:public\.)?["`]StripeWebhookEvent["`]/i;

function filesUnder(root, suffix) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(fullPath, suffix));
    else if (entry.isFile() && fullPath.endsWith(suffix)) result.push(fullPath);
  }
  return result;
}

test("activation audit pins the accepted compatible stack and remaining boundary", () => {
  const normalizedAudit = audit.replace(/\s+/g, " ");
  assert.match(audit, /PR #160 is merged[\s\S]*6f1f4c1e99fb21726744ecd1652a37b6be35c294/);
  assert.match(audit, /31277540714/);
  assert.match(audit, /PR #161[\s\S]*d2ef37b4c86a0ff174016be77113fa1b888131b4/);
  assert.match(audit, /31278958695/);
  assert.match(audit, /PR #162[\s\S]*8abaa36fafd989604a06aa2fee9f1a215e5763b1/);
  assert.match(audit, /423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1/);
  assert.match(audit, /31284293394/);
  assert.match(audit, /31290691183/);
  assert.match(audit, /dpl_67W8RkxzdQwbNTy3rmsEL6WK42D3/);
  assert.match(normalizedAudit, /signed classic Connect delivery\/retry/);
  assert.match(audit, /stripe-webhook-provider-topology-audit\.md/);
  assert.match(normalizedAudit, /three source-bound provider surfaces now have exact test-mode subscription evidence/);
  assert.match(normalizedAudit, /Connect v2 signed delivery remains open/);
  assert.match(audit, /stripe-webhook-ops-health-compatible-production-20260809\.json/);
  assert.match(audit, /all four Stripe counts at zero/);
  assert.match(audit, /stripe-webhook-subscriptions-compatible-production-20260808\.json/);
  assert.match(audit, /stripe-connect-signed-payout-proof-test-20260810-b9444e34\.json/);
  assert.match(audit, /stripe-webhook-subscriptions-test-20260810-b9444e34\.json/);
  assert.match(audit, /stripe-webhook-ops-health-connect-acceptance-20260810-b9444e34\.json/);
  assert.match(normalizedAudit, /Connect v2 signed delivery remains mandatory before launch/);
  assert.match(audit, /d9b637c6a76196579317de3b189046746ca19916/);
  assert.match(audit, /31372665563/);
  assert.match(audit, /dpl_CasoctMLsvfcA1Vj2JJcNUFzXQXP/);
  assert.match(normalizedAudit, /predecessor drain and hardened final compatibility postflight have since passed/);
  assert.match(audit, /fb0facf146e58123ddd2f4a727fda1b966669d5d/);
  assert.match(audit, /31272188477/);
  assert.match(normalizedAudit, /predecessor table posture/);
});

test("activation target is policyless ENABLE with exactly six runtime functions", () => {
  assert.match(audit, /policyless `ENABLE ROW LEVEL SECURITY` first/);
  assert.match(audit, /FORCE held for a later/);
  assert.match(audit, /zero table or column privileges/);
  assert.match(audit, /zero user, seller or staff row policies/);

  const signatures = [
    "grainline_stripe_webhook_begin(text,text)",
    "grainline_stripe_webhook_complete(text,bigint)",
    "grainline_stripe_webhook_fail(text,bigint,text)",
    "grainline_stripe_webhook_prune_batch(integer)",
    "grainline_stripe_webhook_health_summary()",
    "grainline_legacy_stock_restore_claim(text)",
  ];
  for (const signature of signatures) assert.match(audit, new RegExp(signature.replace(/[()]/g, "\\$&")));
  assert.match(audit, /exactly these six fixed signatures/);
  assert.match(audit, /does not authenticate Stripe/);
});

test("ordinary source and buyer-deletion proof have no direct table authority", () => {
  const sourceOffenders = filesUnder("src", ".ts")
    .concat(filesUnder("src", ".tsx"))
    .filter((file) => directAccess.test(fs.readFileSync(file, "utf8")));
  assert.deepEqual(sourceOffenders, []);
  assert.doesNotMatch(buyerProof, /prisma\.stripeWebhookEvent/);
  assert.doesNotMatch(buyerProof, /FROM\s+(?:public\.)?["`]StripeWebhookEvent["`]/i);
});

test("all signed Stripe routes share the fixed lease boundary while v2 stays launch-blocking", () => {
  for (const { file, source } of signedRouteSources) {
    assert.match(source, /beginStripeWebhookEvent\(/, file);
    assert.match(source, /markStripeWebhookEventProcessed\(/, file);
    assert.match(source, /markStripeWebhookEventFailed\(/, file);
    assert.doesNotMatch(source, directAccess, file);
  }
  assert.match(audit, /not a\s+StripeWebhookEvent database-authority gate/);
  assert.match(
    launchChecklist,
    /Connect v2 signed delivery remains launch-blocking/,
  );
});

test("buyer-deletion proof binds Stripe evidence and always rolls back the fixed lease", () => {
  assert.match(buyerProof, /config\.expectedEventId === checkoutAudit\.actorId/);
  assert.match(buyerProof, /stripe\.events\.retrieve\(webhookEventId\)/);
  assert.match(buyerProof, /stripeObjectId\(retrievedEvent\.data\?\.object\) === config\.sessionId/);
  assert.match(buyerProof, /grainline_stripe_webhook_begin/);
  assert.match(buyerProof, /await prisma\.\$transaction/);
  assert.match(buyerProof, /throw new StripeWebhookLeaseProofRollback\(reservation\)/);
  assert.match(buyerProof, /webhookReservation\.action === "processed"/);
  assert.match(audit, /no longer claims to independently read `lastError IS\s+NULL`/);
});

test("all remaining script-level direct access is explicitly classified", () => {
  const directScripts = filesUnder("scripts", ".mjs")
    .filter((file) => directAccess.test(fs.readFileSync(file, "utf8")))
    .sort();
  assert.deepEqual(directScripts, [
    "scripts/blocked-checkout-transfer-binding-postgres-proof.mjs",
    "scripts/build-blocked-checkout-transfer-binding-migration.mjs",
    "scripts/buyer-deletion-stripe-replay-postgres-proof.mjs",
    "scripts/checkout-stock-reservation-production-smoke.mjs",
    "scripts/order-payment-event-blocked-checkout-production-proof.mjs",
    "scripts/order-payment-event-case-refund-production-proof.mjs",
    "scripts/order-payment-event-seller-refund-production-proof.mjs",
    "scripts/order-payment-event-signed-production-proof.mjs",
    "scripts/order-payment-shipping-compatible-production-postflight.mjs",
    "scripts/order-payment-shipping-legacy-inspect.mjs",
    "scripts/order-payment-signed-refund-identity-postgres-proof.mjs",
    "scripts/order-refund-reconciliation-authority-postgres-proof.mjs",
    "scripts/seller-payout-event-activation-postgres-proof.mjs",
    "scripts/seller-payout-event-authority-postgres-proof.mjs",
    "scripts/seller-payout-event-linked-production-proof.mjs",
    "scripts/stripe-connect-signed-payout-proof.mjs",
    "scripts/stripe-webhook-event-activation-postflight-postgres-proof.mjs",
    "scripts/stripe-webhook-event-activation-postgres-proof.mjs",
    "scripts/stripe-webhook-event-activation-production-postflight.mjs",
    "scripts/stripe-webhook-event-activation-rollback-proof.mjs",
    "scripts/stripe-webhook-event-force-postgres-proof.mjs",
    "scripts/stripe-webhook-event-force-production-postflight.mjs",
    "scripts/stripe-webhook-event-force-rollback-proof.mjs",
    "scripts/stripe-webhook-lease-compatibility-postgres-proof.mjs",
    "scripts/stripe-webhook-maintenance-authority-postgres-proof.mjs",
  ]);
  for (const file of directScripts) assert.match(audit, new RegExp(file.replaceAll(".", "\\.")));
  assert.match(audit, /historical compatibility-posture proof/);
  assert.match(audit, /loopback-only\s+disposable PostgreSQL proof of the real Prisma/);
  assert.match(audit, /excluded from post-activation CI\/release phases/);
});

test("audit pins mixed-deployment, rollback and engine-proof boundaries", () => {
  assert.match(audit, /Old Vercel[\s\S]*webhook retries still use direct table CRUD/);
  assert.match(audit, /let the prior app deployment drain/);
  assert.match(audit, /runtime denial of\s+direct SELECT, INSERT, UPDATE and DELETE/);
  assert.match(audit, /rollback restoration of the\s+predecessor/);
  assert.match(audit, /Production postflights are read-only/);
  assert.match(audit, /must never simulate the runtime role through the owner connection/);
});

test("operator proof binds target before connect and attests restricted runtime identity", () => {
  assert.match(buyerProof, /BUYER_DELETION_REPLAY_PROOF_DATABASE_URL/);
  assert.match(buyerProof, /BUYER_DELETION_REPLAY_PROOF_DATABASE_TARGET/);
  assert.match(buyerProof, /must not identify the reviewed production endpoint/);
  assert.match(buyerProof, /rejects privileged database keys/);
  assert.match(buyerProof, /CURRENT_USER AS "currentUser"/);
  assert.match(buyerProof, /SESSION_USER AS "sessionUser"/);
  assert.match(buyerProof, /role\.rolbypassrls AS "bypassRls"/);
  assert.match(audit, /Sanitized evidence records both the configured target/);
  assert.match(audit, /9d2d9d3a82252b991d5fa3f832bd9f629eb1ade9/);
  assert.match(audit, /31280779769/);
  assert.match(audit, /dpl_2u3r9ip2soVEirdbLgQWbfZH8X41/);
  assert.match(audit, /DATABASE_URL_SHAPE/);
});
