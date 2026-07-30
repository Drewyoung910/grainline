import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  parseCaseRecipientReadProofConfig,
} from "../scripts/case-recipient-read-authority-postgres-proof.mjs";

const proof = fs.readFileSync(
  "scripts/case-recipient-read-authority-postgres-proof.mjs",
  "utf8",
);

describe("Case recipient-read PostgreSQL proof", () => {
  it("refuses missing, remote, and wrong-database targets", () => {
    assert.throws(
      () => parseCaseRecipientReadProofConfig({}),
      /CASE_RECIPIENT_READ_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () => parseCaseRecipientReadProofConfig({
        CASE_RECIPIENT_READ_PROOF_DATABASE_URL:
          "postgresql://user:pass@db.example.com/grainline_ci",
      }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () => parseCaseRecipientReadProofConfig({
        CASE_RECIPIENT_READ_PROOF_DATABASE_URL:
          "postgresql://user:pass@127.0.0.1/production",
      }),
      /requires the grainline_ci database/,
    );
  });

  it("accepts only the disposable loopback CI database", () => {
    assert.deepEqual(
      parseCaseRecipientReadProofConfig({
        CASE_RECIPIENT_READ_PROOF_DATABASE_URL:
          "postgresql://user:pass@127.0.0.1/grainline_ci",
      }),
      {
        databaseUrl:
          "postgresql://user:pass@127.0.0.1/grainline_ci",
      },
    );
  });

  it("proves runtime DEFINER authority, projection minimality, context, and cleanup", () => {
    assert.match(proof, /SET LOCAL ROLE grainline_app_runtime/);
    assert.match(proof, /security_definer: true/);
    assert.match(proof, /public_execute: false/);
    assert.match(proof, /runtime_execute: true/);
    assert.match(proof, /proveRecipientAuthority/);
    assert.match(proof, /proveStaffActiveCount/);
    assert.match(proof, /proveTransactionLocalContext/);
    assert.match(proof, /proveInvalidInputs/);
    assert.match(proof, /INSERT INTO public\."OrderItem"/);
    assert.match(proof, /opening-message/);
    assert.match(proof, /row\.createdAt\.toISOString\(\)/);
    assert.match(proof, /row\.sellerRespondBy\.toISOString\(\)/);
    assert.match(proof, /Case recipient reads changed protected state/);
    assert.match(proof, /cleanupFixtures/);
    assert.match(proof, /persistentStagingChanged: false/);
    assert.match(proof, /productionChanged: false/);
  });
});
