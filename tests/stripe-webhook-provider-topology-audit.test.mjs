import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const audit = fs.readFileSync("docs/stripe-webhook-provider-topology-audit.md", "utf8");
const normalized = audit.replace(/\s+/g, " ");

test("provider topology audit separates platform, v2 account, and classic Connect payout paths", () => {
  assert.match(audit, /423d3c1f670a2a4e84dc275eb2c6a4c20234a1f1/);
  assert.match(audit, /dpl_67W8RkxzdQwbNTy3rmsEL6WK42D3/);
  assert.match(audit, /stripe-webhook-subscriptions-compatible-production-20260808\.json/);
  assert.match(normalized, /platform snapshot destination/i);
  assert.match(normalized, /Connect v2 account destination/i);
  assert.match(normalized, /Classic Connect payout destination/i);
  assert.match(audit, /STRIPE_CONNECT_WEBHOOK_SECRET/);
  assert.match(audit, /subscribe only to `payout\.failed`/);
  assert.match(audit, /does not expose its creation-time\s+`connect` source flag/);
});

test("provider topology audit pins the aggregate legacy-account finding", () => {
  assert.match(audit, /\| `v2` \| 2 \| 2 \| 2 \|/);
  assert.match(audit, /\| null\/blank \| 1 \| 0 \| 0 \|/);
  assert.match(audit, /\| other\/legacy \| 0 \| 0 \| 0 \|/);
  assert.match(audit, /no currently linked legacy\/null seller account/i);
  assert.match(audit, /repeatable-read read-only transaction/);
  assert.match(audit, /exported no seller\/account IDs/);
});

test("provider topology audit preserves RLS and mixed-deployment boundaries", () => {
  assert.match(audit, /Do not mutate Stripe until/);
  assert.match(audit, /without accepting either secret on the wrong URL/);
  assert.match(audit, /provider-authenticated test delivery to each/);
  assert.match(audit, /needs no StripeWebhookEvent table grant, RLS policy or new\s+database function/);
  assert.match(audit, /later activation can still revoke direct table access/);
});
