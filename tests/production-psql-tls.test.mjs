import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const WORKFLOW_DIRECTORY = ".github/workflows";

describe("protected production psql TLS roots", () => {
  it("uses the system CA pool for every owner-URL psql step", () => {
    const reviewedSteps = [];

    for (const filename of fs.readdirSync(WORKFLOW_DIRECTORY).sort()) {
      const workflow = fs.readFileSync(
        path.join(WORKFLOW_DIRECTORY, filename),
        "utf8",
      );
      for (const step of workflow.split(/(?=^\s{6}- name: )/mu)) {
        if (
          !step.includes('psql "$DIRECT_URL"') ||
          !step.includes(
            "DIRECT_URL: ${{ secrets.PRODUCTION_MIGRATION_DIRECT_URL }}",
          )
        ) {
          continue;
        }

        const name = step.match(/^\s{6}- name: (.+)$/mu)?.[1];
        assert.ok(name, `${filename} contains an unnamed production psql step`);
        assert.match(
          step,
          /^\s{10}PGSSLROOTCERT: system$/mu,
          `${filename}: ${name} must use libpq's system CA pool`,
        );
        reviewedSteps.push(`${filename}:${name}`);
      }
    }

    assert.deepEqual(reviewedSteps, [
      "direct-upload-activation-production-recovery.yml:Converge activated runtime and cleanup grants",
      "direct-upload-cleanup-role-provision.yml:Converge cleanup role to three-function authority",
      "email-delivery-ledger-preparation-production.yml:Apply reviewed preparation transaction outside Prisma's ledger",
      "email-eligibility-lock-order-correction-production.yml:Apply reviewed correction transaction outside Prisma's ledger",
      "email-outbox-contract-correction-production.yml:Apply reviewed correction transaction outside Prisma's ledger",
      "email-provider-deletion-fence-production.yml:Apply reviewed fence transaction outside Prisma's ledger",
      "email-provider-eligibility-fence-production.yml:Apply reviewed eligibility-fence transaction outside Prisma's ledger",
      "email-suppression-recovery-production.yml:Apply reviewed recovery transaction outside Prisma's ledger",
      "order-case-corrections-production.yml:Converge reviewed runtime function grants",
      "order-compatible-production.yml:Converge compatible runtime grants",
      "order-payment-event-aggregate-authority-production.yml:Converge reviewed runtime grants",
      "order-payment-event-compatible-production.yml:Converge compatible runtime grants",
      "order-payment-event-read-authority-production.yml:Converge OrderPaymentEvent read-authority runtime grants",
      "order-payment-event-transition-authority-production.yml:Converge reviewed runtime grants",
      "owner-table-rls-activation-production.yml:Apply only the reviewed StockNotification activation transaction",
      "resend-webhook-receipt-recovery-production.yml:Apply reviewed recovery transaction outside Prisma's ledger",
      "support-request-email-reuse-production.yml:Apply reviewed correction transaction outside Prisma's ledger",
      "user-rls-enable-production.yml:Re-converge runtime grants after User ENABLE",
      "user-rls-force-production.yml:Re-converge runtime grants after User FORCE",
    ]);
  });
});
