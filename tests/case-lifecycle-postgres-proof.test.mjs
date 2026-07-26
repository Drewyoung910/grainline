import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseProofConfig,
} from "../scripts/case-lifecycle-postgres-proof.mjs";

const proof = readFileSync(
  "scripts/case-lifecycle-postgres-proof.mjs",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/case-lifecycle-postgres-proof.yml",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("Case lifecycle PostgreSQL proof harness", () => {
  it("refuses every non-loopback or non-disposable database target", () => {
    assert.throws(
      () => parseProofConfig({}),
      /CASE_LIFECYCLE_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseProofConfig({
          CASE_LIFECYCLE_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseProofConfig({
          CASE_LIFECYCLE_PROOF_DATABASE_URL:
            "postgresql://ci:ci@127.0.0.1/production",
        }),
      /requires the grainline_ci database/,
    );
    assert.deepEqual(
      parseProofConfig({
        CASE_LIFECYCLE_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1/grainline_ci",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci",
      },
    );
  });

  it("forces real two-session lock waits for every required winner ordering", () => {
    assert.match(proof, /pg_catalog\.pg_stat_activity/);
    assert.match(proof, /wait_event_type === "Lock"/);
    assert.match(proof, /did not enter a PostgreSQL lock wait/);
    assert.match(proof, /lockOrderForCaseLifecycle/);
    assert.match(proof, /lockCaseForLifecycle/);
    assert.match(proof, /databaseClockTimestamp/);
    for (const check of [
      "case_before_label",
      "label_before_case",
      "case_before_fulfillment",
      "fulfillment_before_case",
      "case_before_delivery_confirmation",
      "delivery_confirmation_before_case",
      "refund_before_case",
      "case_before_refund_then_resolution",
      "different_body_replies_serialize",
      "seller_first_reply_sets_one_discussion_clock",
      "pending_close_reply_before_resolution_mark",
      "resolution_mark_before_pending_close_reply",
      "refund_reservation_before_resolution_mark",
      "resolution_mark_before_refund_reservation",
      "seller_reply_before_cron",
      "cron_before_seller_reply",
      "discussion_reply_before_cron_keeps_time_monotonic",
      "reply_before_staff_dismissal",
      "resolution_mark_before_staff_dismissal",
      "staff_dismissal_before_resolution_mark",
      "staff_dismissal_before_reply",
    ]) {
      assert.match(proof, new RegExp(`"${check}"`));
    }
    assert.match(proof, /caseMessageStatusTransition/);
    assert.match(proof, /canCreateCaseMessageForStatus/);
    assert.match(proof, /import \{ REFUND_LOCK_SENTINEL \}/);
    assert.match(proof, /"sellerRefundId" = \$\{REFUND_LOCK_SENTINEL\}/);
    assert.doesNotMatch(proof, /__refund_in_progress__/);
    assert.match(proof, /checks\.length, 21/);
  });

  it("cleans every fixture and records that no persistent environment changed", () => {
    assert.match(proof, /async function cleanupFixtures/);
    assert.match(proof, /await cleanupFixtures\(observer\)\.catch/);
    assert.match(proof, /persistentStagingChanged: false/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /example\.invalid/);
    assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
  });

  it("runs after the full migration tree in a branch-scoped PostgreSQL 16 workflow", () => {
    assert.match(workflow, /agent\/case-integrity-phase1b-20260726/);
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /POSTGRES_DB: grainline_ci/);
    assert.match(workflow, /npx prisma migrate deploy/);
    assert.match(workflow, /npm run audit:rls-case-lifecycle-races/);
    assert.equal(
      packageJson.scripts["audit:rls-case-lifecycle-races"],
      "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/case-lifecycle-postgres-proof.mjs",
    );
  });
});
