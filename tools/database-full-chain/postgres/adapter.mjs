import { containsConcurrentIndex, splitSqlStatements } from "../scenarios/migration-chain.mjs";

function normalizedExpectedMajor(expectedMajor) {
  const value = String(expectedMajor ?? "").trim();
  if (!/^\d+$/u.test(value)) {
    throw new Error("expectedMajor must be a PostgreSQL major version");
  }
  return value;
}

export function assertDisposablePostgresTarget(
  target,
  serverVersion,
  { expectedMajor } = {},
) {
  const major = normalizedExpectedMajor(expectedMajor);
  const url = new URL(target);
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(host)) {
    throw new Error("the PostgreSQL full-chain harness accepts loopback targets only");
  }
  if (url.pathname !== "/grainline_ci") {
    throw new Error("the PostgreSQL full-chain harness requires database grainline_ci");
  }
  if (decodeURIComponent(url.username) !== "ci") {
    throw new Error("the PostgreSQL full-chain harness requires migration owner ci");
  }
  if (serverVersion && !new RegExp(`^${major}(?:\\.|$)`, "u").test(String(serverVersion))) {
    throw new Error(`PostgreSQL ${major} required, got ${serverVersion}`);
  }
  return url;
}

// Pass a connected pg.Client. The caller owns connection lifecycle and all
// credentials; this module stores neither URLs nor passwords.
export function createPostgresAdapter(client, { ownerRole = "ci" } = {}) {
  if (!client?.query) throw new TypeError("a connected pg.Client is required");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(ownerRole)) {
    throw new Error("ownerRole must be a PostgreSQL identifier");
  }
  return Object.freeze({
    query: (sql, params = []) => client.query(sql, params),
    executeMigration: async (sql, metadata = {}) => {
      if (metadata.containsConcurrentIndex ?? containsConcurrentIndex(sql)) {
        for (const statement of splitSqlStatements(sql)) await client.query(statement);
      } else {
        await client.query(sql);
      }
    },
    executeStatements: async (sql) => {
      for (const statement of splitSqlStatements(sql)) await client.query(statement);
    },
    resetOwner: async () => {
      try {
        await client.query("ROLLBACK");
      } catch {}
      await client.query("RESET ROLE");
      await client.query("RESET SESSION AUTHORIZATION");
      const result = await client.query(
        "SELECT current_user, session_user, current_setting('TimeZone') AS timezone",
      );
      const row = result.rows[0];
      if (row.current_user !== ownerRole || row.session_user !== ownerRole) {
        throw new Error(
          `owner reset failed: ${row.current_user}/${row.session_user}, expected ${ownerRole}`,
        );
      }
      await client.query("SET TIME ZONE 'UTC'");
    },
  });
}
