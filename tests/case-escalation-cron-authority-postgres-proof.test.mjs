import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  parseCaseEscalationCronProofConfig,
  runCaseEscalationCronAuthorityProof,
} from "../scripts/case-escalation-cron-authority-postgres-proof.mjs";

const source = fs.readFileSync(
  "scripts/case-escalation-cron-authority-postgres-proof.mjs",
  "utf8",
);

describe("Case escalation and cron-transition PostgreSQL proof", () => {
  it("refuses remote databases and the wrong local database", () => {
    assert.throws(
      () => parseCaseEscalationCronProofConfig({}),
      /CASE_ESCALATION_CRON_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () => parseCaseEscalationCronProofConfig({
        CASE_ESCALATION_CRON_PROOF_DATABASE_URL:
          "postgresql://proof:secret@example.com:5432/grainline_ci",
      }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () => parseCaseEscalationCronProofConfig({
        CASE_ESCALATION_CRON_PROOF_DATABASE_URL:
          "postgresql://proof:secret@127.0.0.1:5432/postgres",
      }),
      /requires the grainline_ci database/,
    );
  });

  it("pins isolation, authority, clocks, races, notifications, and cleanup", () => {
    for (const marker of [
      "preflight-zero-residue",
      "catalog-grants-and-forced-direct-denial",
      "participant-staff-replay-and-lease-authority",
      "three-families-atomic-audit-notification-and-replay",
      "order-skip-locked",
      "concurrent-workers-no-duplicate-transition",
      "reply-cron-both-winner-orderings",
      "caller-rollback",
      "cleanup-zero-residue",
    ]) {
      assert.match(source, new RegExp(marker));
    }
    assert.match(
      source,
      /ALTER TABLE public\."Case" FORCE ROW LEVEL SECURITY/,
    );
    assert.match(source, /SET LOCAL ROLE grainline_app_runtime/);
    assert.match(source, /pg_catalog\.aclexplode/);
    assert.match(source, /publicExecute: false/);
    assert.match(source, /randomUUID\(\)/);
    assert.match(source, /grainline_notification_create_case_event/);
    assert.match(source, /Promise\.all\(\[/);
    assert.match(source, /FOR UPDATE/);
    assert.match(source, /Case is closed/);
    assert.match(source, /assertZeroResidue/);
  });

  const databaseUrl =
    process.env.CASE_ESCALATION_CRON_PROOF_DATABASE_URL;
  (databaseUrl ? it : it.skip)(
    "executes all checks in disposable PostgreSQL",
    async () => {
      const result = await runCaseEscalationCronAuthorityProof({
        CASE_ESCALATION_CRON_PROOF_DATABASE_URL: databaseUrl,
      });
      assert.equal(result.checks.length, 9);
    },
  );
});
