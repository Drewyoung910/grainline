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
          !step.includes('psql "$DIRECT_URL"')
          || !step.includes(
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
      "order-compatible-production.yml:Converge compatible runtime grants",
      "order-payment-event-aggregate-authority-production.yml:Converge reviewed runtime grants",
      "order-payment-event-compatible-production.yml:Converge compatible runtime grants",
      "order-payment-event-read-authority-production.yml:Converge OrderPaymentEvent read-authority runtime grants",
      "order-payment-event-transition-authority-production.yml:Converge reviewed runtime grants",
      "production-migrations.yml:Converge exact FORCE-hardened OrderPaymentEvent runtime grants",
    ]);
  });
});
