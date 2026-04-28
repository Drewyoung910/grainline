import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { normalizeRuntimeDatabaseUrl } = await import("../src/lib/databaseUrl.ts");

describe("runtime database URL normalization", () => {
  it("pins ambiguous pg SSL modes to current verify-full behavior", () => {
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db?sslmode=require"),
      "postgresql://u:p@example.test/db?sslmode=verify-full",
    );
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db?sslmode=prefer"),
      "postgresql://u:p@example.test/db?sslmode=verify-full",
    );
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db?sslmode=verify-ca"),
      "postgresql://u:p@example.test/db?sslmode=verify-full",
    );
  });

  it("leaves explicit, absent, and invalid modes unchanged", () => {
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db?sslmode=verify-full"),
      "postgresql://u:p@example.test/db?sslmode=verify-full",
    );
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db?sslmode=disable"),
      "postgresql://u:p@example.test/db?sslmode=disable",
    );
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db"),
      "postgresql://u:p@example.test/db",
    );
    assert.equal(normalizeRuntimeDatabaseUrl("not a url"), "not a url");
  });
});
