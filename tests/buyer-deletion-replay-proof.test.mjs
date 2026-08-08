import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("buyer-deletion Stripe replay proof harness", () => {
  function baseConfig() {
    return {
      BUYER_DELETION_REPLAY_PROOF_CONFIRM: "test-mode-replay",
      BUYER_DELETION_REPLAY_PROOF_DB_CONFIRM: "staging-or-local-read",
      BUYER_DELETION_REPLAY_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:proof@127.0.0.1:5432/grainline_ci?sslmode=disable",
      BUYER_DELETION_REPLAY_PROOF_DATABASE_TARGET: "local",
      BUYER_DELETION_REPLAY_PROOF_DATABASE_NAME: "grainline_ci",
      BUYER_DELETION_REPLAY_PROOF_SESSION_ID: "cs_test_buyer_deletion",
      BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH:
        ".codex/buyer-deletion-replay-test-evidence.json",
      STRIPE_SECRET_KEY: "sk_test_buyer_deletion",
    };
  }

  it("exposes the replay verifier as an explicit npm command", () => {
    const pkg = JSON.parse(source("package.json"));

    assert.equal(
      pkg.scripts["audit:buyer-deletion-replay"],
      "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/buyer-deletion-stripe-replay-proof.mjs",
    );
  });

  it("fails closed to Stripe test-mode replay and staging/local read verification", () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /const CONFIRMATION_VALUE = "test-mode-replay"/);
    assert.match(script, /const DB_CONFIRMATION_VALUE = "staging-or-local-read"/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_CONFIRM/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_DB_CONFIRM/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_DATABASE_URL/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_DATABASE_TARGET/);
    assert.match(script, /must not identify the reviewed production endpoint/);
    assert.match(script, /CURRENT_USER AS "currentUser"/);
    assert.match(script, /role\.rolbypassrls AS "bypassRls"/);
    assert.match(script, /STRIPE_SECRET_KEY must be a Stripe test-mode secret key/);
    assert.match(script, /!secretKey\.startsWith\("sk_test_"\)/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_SESSION_ID/);
    assert.match(script, /!sessionId\.startsWith\("cs_test_"\)/);
    assert.match(script, /BUYER_DELETION_REPLAY_PROOF_EVIDENCE_PATH/);
    assert.match(script, /must stay inside the repository/);
    assert.match(script, /pathToFileURL\(process\.argv\[1\]\)\.href/);
  });

  it("binds local and Neon staging URLs to the exact restricted runtime target", async () => {
    const { parseConfig } = await import(
      "../scripts/buyer-deletion-stripe-replay-proof.mjs"
    );
    const local = parseConfig(baseConfig());
    assert.deepEqual(local.databaseIdentity, {
      databaseName: "grainline_ci",
      endpointId: "loopback",
      isPooler: false,
      region: "loopback",
      runtimeRole: "grainline_app_runtime",
      target: "local",
    });

    const staging = baseConfig();
    staging.BUYER_DELETION_REPLAY_PROOF_DATABASE_TARGET = "neon-staging";
    staging.BUYER_DELETION_REPLAY_PROOF_DATABASE_NAME = "neondb";
    staging.BUYER_DELETION_REPLAY_PROOF_DATABASE_ENDPOINT_ID = "ep-staging-proof";
    staging.BUYER_DELETION_REPLAY_PROOF_DATABASE_REGION = "us-east-2.aws";
    staging.BUYER_DELETION_REPLAY_PROOF_DATABASE_URL =
      "postgresql://grainline_app_runtime:proof@ep-staging-proof-pooler.us-east-2.aws.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
    assert.deepEqual(parseConfig(staging).databaseIdentity, {
      databaseName: "neondb",
      endpointId: "ep-staging-proof",
      isPooler: true,
      region: "us-east-2.aws",
      runtimeRole: "grainline_app_runtime",
      target: "neon-staging",
    });
  });

  it("rejects owner, production, remote-local, target drift, and aliased database URLs", async () => {
    const { parseConfig } = await import(
      "../scripts/buyer-deletion-stripe-replay-proof.mjs"
    );
    for (const [change, pattern] of [
      [
        {
          BUYER_DELETION_REPLAY_PROOF_DATABASE_URL:
            "postgresql://neondb_owner:proof@127.0.0.1:5432/grainline_ci?sslmode=disable",
        },
        /must authenticate as grainline_app_runtime/,
      ],
      [
        {
          BUYER_DELETION_REPLAY_PROOF_DATABASE_URL:
            "postgresql://grainline_app_runtime:proof@database.example:5432/grainline_ci?sslmode=disable",
        },
        /must use a loopback host/,
      ],
      [
        { BUYER_DELETION_REPLAY_PROOF_DATABASE_NAME: "wrong_database" },
        /database does not match/,
      ],
      [
        { DATABASE_URL: "postgresql://owner:secret@example.test:5432/neondb" },
        /rejects aliased PostgreSQL URLs: DATABASE_URL/,
      ],
      [
        { DIRECT_URL: "postgresql://owner:secret@example.test:5432/neondb" },
        /rejects privileged database keys: DIRECT_URL/,
      ],
    ]) {
      assert.throws(() => parseConfig({ ...baseConfig(), ...change }), pattern);
    }

    const production = {
      ...baseConfig(),
      BUYER_DELETION_REPLAY_PROOF_DATABASE_TARGET: "neon-staging",
      BUYER_DELETION_REPLAY_PROOF_DATABASE_NAME: "neondb",
      BUYER_DELETION_REPLAY_PROOF_DATABASE_ENDPOINT_ID: "ep-plain-river-aaqg8gj4",
      BUYER_DELETION_REPLAY_PROOF_DATABASE_REGION: "westus3.azure",
      BUYER_DELETION_REPLAY_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:proof@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require",
    };
    assert.throws(
      () => parseConfig(production),
      /must not identify the reviewed production endpoint/,
    );
  });

  it("requires engine-attested runtime identity and least-privilege role flags", async () => {
    const { assertBuyerDeletionReplayRuntimeIdentityRows } = await import(
      "../scripts/buyer-deletion-stripe-replay-proof.mjs"
    );
    const expectedIdentity = {
      databaseName: "grainline_ci",
      runtimeRole: "grainline_app_runtime",
    };
    const row = {
      databaseName: "grainline_ci",
      currentUser: "grainline_app_runtime",
      sessionUser: "grainline_app_runtime",
      superuser: false,
      createDatabase: false,
      createRole: false,
      inherit: false,
      login: true,
      replication: false,
      bypassRls: false,
    };
    assert.deepEqual(
      assertBuyerDeletionReplayRuntimeIdentityRows([row], expectedIdentity),
      row,
    );
    for (const [key, value] of [
      ["currentUser", "neondb_owner"],
      ["sessionUser", "neondb_owner"],
      ["databaseName", "neondb"],
      ["superuser", true],
      ["createDatabase", true],
      ["createRole", true],
      ["inherit", true],
      ["login", false],
      ["replication", true],
      ["bypassRls", true],
    ]) {
      assert.throws(
        () => assertBuyerDeletionReplayRuntimeIdentityRows(
          [{ ...row, [key]: value }],
          expectedIdentity,
        ),
        /exact restricted runtime role/,
      );
    }
  });

  it("verifies a real paid Stripe session instead of fabricating checkout completion", () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /new Stripe\(config\.secretKey, \{ apiVersion: STRIPE_API_VERSION \}\)/);
    assert.match(script, /stripe\.checkout\.sessions\.retrieve\(config\.sessionId/);
    assert.match(script, /expand: \["payment_intent\.latest_charge"\]/);
    assert.match(script, /session\.livemode === false/);
    assert.match(script, /session\.payment_status === "paid"/);
    assert.match(script, /session\.metadata\?\.buyerId/);
    assert.match(script, /stripe\.events\.retrieve\(webhookEventId\)/);
    assert.match(script, /retrievedEvent\.type === "checkout\.session\.completed"/);
    assert.match(script, /config\.expectedEventId === checkoutAudit\.actorId/);
    assert.doesNotMatch(script, /checkout\.sessions\.create/);
    assert.doesNotMatch(script, /paymentIntents\.create/);
    assert.doesNotMatch(script, /order\.create\(/);
    assert.doesNotMatch(script, /order\.upsert/);
  });

  it("checks the source buyer state and local blocked-order PII purge", () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /prisma\.user\.findUnique/);
    assert.match(script, /buyerStateReason\(sourceBuyer\)/);
    assert.match(script, /Buyer account was deleted before payment completion/);
    assert.match(script, /Buyer account was suspended before payment completion/);
    assert.match(script, /Buyer account could not be verified at payment completion/);
    assert.match(script, /prisma\.order\.findUnique/);
    assert.match(script, /where: \{ stripeSessionId: config\.sessionId \}/);
    assert.match(script, /BUYER_PII_FIELDS/);
    assert.match(script, /order\.buyerId == null/);
    assert.match(script, /piiFieldsWithValues\.length === 0/);
    assert.match(script, /Boolean\(order\.buyerDataPurgedAt\)/);
    assert.match(script, /order\.reviewNeeded === true/);
    assert.match(script, /BLOCKED_CHECKOUT_REVIEW_MARKER/);
  });

  it("requires processed fixed-lease, refund ledger, and system audit evidence", () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /order\.sellerRefundId\?\.startsWith\("re_"\)/);
    assert.match(script, /order\.sellerRefundLockedAt == null/);
    assert.match(script, /firstMatchingRefundEvent\(order\)/);
    assert.match(script, /metadataValue\(refundEvent\.metadata, "localAction"\) === BLOCKED_REFUND_ACTION/);
    assert.match(script, /refundAccounting\.buyerRefundAmountCents === order\.sellerRefundAmountCents/);
    assert.match(script, /prisma\.systemAuditLog\.findFirst/);
    assert.match(script, /action: CHECKOUT_CREATED_ACTION/);
    assert.match(script, /action: BLOCKED_REFUND_ACTION/);
    assert.match(script, /proveProcessedStripeWebhookEvent/);
    assert.match(script, /grainline_stripe_webhook_begin/);
    assert.match(script, /webhookReservation\.action === "processed"/);
    assert.doesNotMatch(script, /prisma\.stripeWebhookEvent/);
    assert.doesNotMatch(script, /webhookEvent\.lastError/);
  });

  it("always rolls back the fixed lease probe, including a missing-row process claim", async () => {
    const { proveProcessedStripeWebhookEvent } = await import(
      "../scripts/buyer-deletion-stripe-replay-proof.mjs"
    );

    for (const expectedAction of ["processed", "process", "in_progress"]) {
      let rolledBack = false;
      let querySeen = false;
      const prisma = {
        async $transaction(work) {
          try {
            return await work({
              async $queryRaw(query) {
                querySeen = true;
                assert.match(query.text, /grainline_stripe_webhook_begin/);
                return [{ action: expectedAction, claim_generation: expectedAction === "process" ? 1n : 2n }];
              },
            });
          } catch (error) {
            rolledBack = true;
            throw error;
          }
        },
      };

      const reservation = await proveProcessedStripeWebhookEvent(
        prisma,
        "evt_test_buyer_deletion",
        "checkout.session.completed",
      );
      assert.equal(querySeen, true);
      assert.equal(rolledBack, true);
      assert.equal(reservation.action, expectedAction);
    }
  });

  it("redacts retained evidence and stores hashes instead of raw Stripe or DB identifiers", async () => {
    const script = source("scripts/buyer-deletion-stripe-replay-proof.mjs");

    assert.match(script, /DB_ENV_ASSIGNMENT_PATTERN/);
    assert.match(script, /POSTGRES_URL_PATTERN/);
    assert.match(script, /STRIPE_SECRET_PATTERN/);
    assert.match(script, /URL_USERINFO_PATTERN/);
    assert.match(script, /BEARER_PATTERN/);
    assert.match(script, /hashValue\(config\.sessionId\)/);
    assert.match(script, /metadataBuyerIdHash/);
    assert.match(script, /paymentIntentIdHash/);
    assert.match(script, /chargeIdHash/);
    assert.match(script, /issues: issues\.slice\(0, EVIDENCE_MAX_ISSUES\)\.map\(redact\)/);

    const { buildEvidencePayload } = await import("../scripts/buyer-deletion-stripe-replay-proof.mjs");
    const payload = buildEvidencePayload({
      actionableCount: 1,
      completedAt: "2026-07-11T00:00:01.000Z",
      config: {
        expectedBuyerState: "deleted",
        expectedEventId: "evt_test_secret",
        sessionId: "cs_test_secret",
      },
      issues: [
        "DATABASE_URL=postgres://user:secret@example/db STRIPE_SECRET_KEY=sk_test_secret Bearer token-value",
      ],
      proof: null,
      startedAt: "2026-07-11T00:00:00.000Z",
      status: "failed",
    });
    const serialized = JSON.stringify(payload);

    assert.match(serialized, /\[redacted-buyer-deletion-replay-proof-env\]/);
    assert.doesNotMatch(serialized, /postgres:\/\/user:secret/);
    assert.doesNotMatch(serialized, /sk_test_secret/);
    assert.doesNotMatch(serialized, /cs_test_secret/);
    assert.doesNotMatch(serialized, /evt_test_secret/);
    assert.doesNotMatch(serialized, /token-value/);
  });

  it("documents the verifier as launch evidence without claiming it has already run", () => {
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");
    const backlog = source("docs/deferred-launch-backlog.md");
    const claude = source("CLAUDE.md");

    assert.match(launch, /npm run audit:buyer-deletion-replay/);
    assert.match(launch, /real paid Checkout Session whose original buyer was deleted, suspended, or missing/);
    assert.match(runbook, /Pre-launch buyer-deletion Stripe replay proof/);
    assert.match(runbook, /does not create or fake a paid Checkout Session/);
    assert.match(backlog, /`npm run audit:buyer-deletion-replay`/);
    assert.match(claude, /Do not close the buyer-deletion Stripe replay launch blocker from source tests/);
  });
});
