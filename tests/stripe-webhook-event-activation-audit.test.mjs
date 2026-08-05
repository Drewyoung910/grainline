import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const audit = fs.readFileSync("docs/stripe-webhook-event-activation-audit.md", "utf8");
const buyerProof = fs.readFileSync("scripts/buyer-deletion-stripe-replay-proof.mjs", "utf8");
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

test("activation audit pins the exact draft stack and keeps production unchanged", () => {
  assert.match(audit, /PR #160[\s\S]*2b624afe219bc982dd0945284895326ee6893a1e/);
  assert.match(audit, /PR #161[\s\S]*566edf0e301a475577d53b84776fe9ee375ed506/);
  assert.match(audit, /PR #162[\s\S]*eb2c49d5d8a061ca410cd42e4da06d2a6b4cf806/);
  assert.match(audit, /30975525699/);
  assert.match(audit, /All three PRs remain draft/);
  assert.match(audit, /production retains the inspected predecessor/);
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
    "scripts/order-payment-shipping-compatible-production-postflight.mjs",
    "scripts/order-payment-shipping-legacy-inspect.mjs",
    "scripts/stripe-webhook-lease-compatibility-postgres-proof.mjs",
    "scripts/stripe-webhook-maintenance-authority-postgres-proof.mjs",
  ]);
  for (const file of directScripts) assert.match(audit, new RegExp(file.replaceAll(".", "\\.")));
  assert.match(audit, /historical compatibility-posture proof/);
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
