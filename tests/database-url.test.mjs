import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  normalizeRuntimeDatabaseUrl,
  runtimeDatabasePoolOptions,
} = await import("../src/lib/databaseUrl.ts");

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

  it("pins missing SSL modes to verify-full", () => {
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db"),
      "postgresql://u:p@example.test/db?sslmode=verify-full",
    );
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db?connection_limit=5"),
      "postgresql://u:p@example.test/db?connection_limit=5&sslmode=verify-full",
    );
  });

  it("leaves explicit and invalid modes unchanged", () => {
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db?sslmode=verify-full"),
      "postgresql://u:p@example.test/db?sslmode=verify-full",
    );
    assert.equal(
      normalizeRuntimeDatabaseUrl("postgresql://u:p@example.test/db?sslmode=disable"),
      "postgresql://u:p@example.test/db?sslmode=disable",
    );
    assert.equal(normalizeRuntimeDatabaseUrl("not a url"), "not a url");
  });

  it("opts the runtime pool into channel binding when the URL requests it", () => {
    assert.deepEqual(
      runtimeDatabasePoolOptions(
        "postgresql://u:p@example.test/db?sslmode=verify-full&channel_binding=require",
      ),
      {
        connectionString:
          "postgresql://u:p@example.test/db?sslmode=verify-full&channel_binding=require",
        enableChannelBinding: true,
      },
    );
    assert.deepEqual(
      runtimeDatabasePoolOptions(
        "postgresql://u:p@example.test/db?sslmode=verify-full",
      ),
      {
        connectionString: "postgresql://u:p@example.test/db?sslmode=verify-full",
      },
    );
  });
});
