import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const {
  resolveClientSentryDsn,
  resolveServerSentryDsn,
} = await import("../src/lib/sentryDsn.ts");

describe("Sentry DSN configuration", () => {
  it("requires a server-side Sentry DSN in production", () => {
    assert.throws(
      () => resolveServerSentryDsn({}, "production"),
      /SENTRY_DSN or NEXT_PUBLIC_SENTRY_DSN is required in production/,
    );
    assert.equal(resolveServerSentryDsn({ SENTRY_DSN: " https://server@example/1 " }, "production"), "https://server@example/1");
    assert.equal(resolveServerSentryDsn({ NEXT_PUBLIC_SENTRY_DSN: "https://public@example/1" }, "production"), "https://public@example/1");
  });

  it("requires a browser Sentry DSN in production", () => {
    assert.throws(
      () => resolveClientSentryDsn({}, "production"),
      /NEXT_PUBLIC_SENTRY_DSN is required in production/,
    );
    assert.equal(resolveClientSentryDsn({ NEXT_PUBLIC_SENTRY_DSN: " https://public@example/1 " }, "production"), "https://public@example/1");
  });

  it("keeps development and test environments permissive", () => {
    assert.equal(resolveServerSentryDsn({}, "development"), "");
    assert.equal(resolveClientSentryDsn({}, "test"), "");
  });

  it("keeps Sentry config files off empty-string DSN fallbacks", () => {
    const server = fs.readFileSync("sentry.server.config.ts", "utf8");
    const edge = fs.readFileSync("sentry.edge.config.ts", "utf8");
    const client = fs.readFileSync("src/instrumentation-client.ts", "utf8");

    assert.match(server, /dsn: resolveServerSentryDsn\(\)/);
    assert.match(edge, /dsn: resolveServerSentryDsn\(\)/);
    assert.match(client, /dsn: resolveClientSentryDsn\(\{/);
    for (const source of [server, edge, client]) {
      assert.doesNotMatch(source, /dsn:\s*process\.env\.[A-Z_]+\s*\?\?\s*""/);
      assert.doesNotMatch(source, /\?\?\s*""/);
    }
  });
});
