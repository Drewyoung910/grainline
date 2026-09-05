import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import {
  parseOrderZeroDirectCompatiblePrefixProofConfig,
} from "../scripts/order-zero-direct-compatible-prefix-postgres-proof.mjs";

const ENVIRONMENT = "ORDER_ZERO_DIRECT_COMPATIBLE_PREFIX_PROOF_DATABASE_URL";

describe("Order zero-direct compatible real-PostgreSQL proof", () => {
  it("accepts only a loopback grainline_ci owner connection", () => {
    assert.deepEqual(
      parseOrderZeroDirectCompatiblePrefixProofConfig({
        [ENVIRONMENT]: "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable",
        expectedRole: "ci",
      },
    );
    for (const databaseUrl of [
      "postgresql://ci:ci@db.example.com:5432/grainline_ci",
      "postgresql://ci:ci@127.0.0.1:5432/production",
      "postgresql://grainline_app_runtime:secret@127.0.0.1:5432/grainline_ci",
    ]) {
      assert.throws(
        () => parseOrderZeroDirectCompatiblePrefixProofConfig({
          [ENVIRONMENT]: databaseUrl,
        }),
      );
    }
  });

  it("is engine-read-only, exact-catalog, and secret-sanitized", () => {
    const source = fs.readFileSync(
      "scripts/order-zero-direct-compatible-prefix-postgres-proof.mjs",
      "utf8",
    );
    assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
    assert.match(source, /current_setting\('transaction_read_only'\)/u);
    assert.match(source, /public\._prisma_migrations/u);
    assert.match(source, /pg_catalog\.oidvectortypes\(procedure\.proargtypes\)/u);
    assert.match(source, /pg_catalog\.aclexplode/u);
    assert.match(source, /class\.oid = constraint\.conrelid/u);
    assert.match(source, /procedure\.oid = trigger\.tgfoid/u);
    assert.match(source, /\[redacted-postgres-url\]/u);
    assert.doesNotMatch(
      source,
      /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE)\b/iu,
    );
  });
});
