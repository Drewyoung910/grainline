import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  parseBuyerDeletionReplayPostgresProofConfig,
} from "../scripts/buyer-deletion-stripe-replay-postgres-proof.mjs";

const PROOF_URL =
  "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";

test("buyer-deletion rollback proof refuses persistent, wrong-database and non-owner targets", () => {
  assert.throws(
    () => parseBuyerDeletionReplayPostgresProofConfig({}),
    /BUYER_DELETION_REPLAY_POSTGRES_PROOF_DATABASE_URL is required/,
  );
  for (const [databaseUrl, pattern] of [
    [
      "postgresql://ci:ci@database.example:5432/grainline_ci?sslmode=disable",
      /refuses a non-loopback database/,
    ],
    [
      "postgresql://ci:ci@127.0.0.1:5432/neondb?sslmode=disable",
      /requires grainline_ci/,
    ],
    [
      "postgresql://neondb_owner:ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
      /requires owner ci/,
    ],
  ]) {
    assert.throws(
      () => parseBuyerDeletionReplayPostgresProofConfig({
        BUYER_DELETION_REPLAY_POSTGRES_PROOF_DATABASE_URL: databaseUrl,
      }),
      pattern,
    );
  }
  assert.deepEqual(
    parseBuyerDeletionReplayPostgresProofConfig({
      BUYER_DELETION_REPLAY_POSTGRES_PROOF_DATABASE_URL: PROOF_URL,
    }),
    { databaseUrl: PROOF_URL },
  );
});

test("buyer-deletion rollback proof uses actual Prisma transactions and leaves exact zero residue", () => {
  const proof = readFileSync(
    "scripts/buyer-deletion-stripe-replay-postgres-proof.mjs",
    "utf8",
  );
  assert.match(proof, /proveProcessedStripeWebhookEvent/);
  assert.match(proof, /verifyBuyerDeletionReplayRuntimeIdentity/);
  assert.match(proof, /rolledBackMissingInsert: true/);
  assert.match(proof, /rolledBackStaleReclaim: true/);
  assert.match(proof, /Stripe webhook event type is immutable/);
  assert.match(proof, /DELETE FROM public\."StripeWebhookEvent"/);
  assert.match(proof, /assert\.equal\(residue, 0/);
});

test("CI runs the real PostgreSQL buyer-deletion rollback proof after fixed functions exist", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["audit:buyer-deletion-replay-postgres"],
    "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/buyer-deletion-stripe-replay-postgres-proof.mjs",
  );
  assert.match(
    ci,
    /Prove buyer-deletion fixed-lease verifier rollback in PostgreSQL[\s\S]{0,260}BUYER_DELETION_REPLAY_POSTGRES_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
  );
});
