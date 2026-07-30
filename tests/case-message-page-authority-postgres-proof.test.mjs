import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  parseCaseMessagePageProofConfig,
} from "../scripts/case-message-page-authority-postgres-proof.mjs";

const key = "CASE_MESSAGE_PAGE_PROOF_DATABASE_URL";

describe("Case-message page PostgreSQL proof", () => {
  it("refuses missing, non-loopback, and wrong-database targets", () => {
    assert.throws(() => parseCaseMessagePageProofConfig({}), /is required/);
    assert.throws(
      () => parseCaseMessagePageProofConfig({
        [key]: "postgresql://user:pass@database.example/grainline_ci",
      }),
      /non-loopback/,
    );
    assert.throws(
      () => parseCaseMessagePageProofConfig({
        [key]: "postgresql://user:pass@127.0.0.1/other",
      }),
      /requires the grainline_ci database/,
    );
  });

  it("accepts only the disposable loopback database", () => {
    assert.deepEqual(
      parseCaseMessagePageProofConfig({
        [key]: "postgresql://user:pass@127.0.0.1:5432/grainline_ci",
      }),
      {
        databaseUrl:
          "postgresql://user:pass@127.0.0.1:5432/grainline_ci",
      },
    );
  });

  it("pins authority, page, privacy, mutation, and cleanup checks", () => {
    const source = fs.readFileSync(
      "scripts/case-message-page-authority-postgres-proof.mjs",
      "utf8",
    );
    for (const marker of [
      "proveCatalog",
      "proveRecipientAuthority",
      "proveStableBoundedPage",
      "proveMinimalAttachmentProjection",
      "proveCanonicalAuthorKindProjection",
      "proveTransactionLocalContext",
      "proveInvalidInputs",
      "Case-message page changed protected table state",
      "persistentStagingChanged: false",
      "productionChanged: false",
    ]) {
      assert.match(source, new RegExp(marker));
    }
    assert.match(source, /SET LOCAL ROLE grainline_app_runtime/);
    assert.match(source, /INSERT INTO public\."OrderItem"/);
    assert.match(source, /27_000 \+ position/);
    assert.doesNotMatch(source, /authorKind", body, "createdAt"\s*\)\s*VALUES\s*\(\s*\$1, \$2, \$3, NULL/);
    assert.match(source, /objectKey\|directUploadId\|caseEvidenceImage/);
    assert.match(source, /rowCount, 51/);
  });
});
