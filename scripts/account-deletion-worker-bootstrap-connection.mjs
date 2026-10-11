// Dormant connection adapter. No CLI, credential loader, journal or provider writes.
import assert from "node:assert/strict";
import pg from "pg";
import { REVIEWED_PRODUCTION_ACCOUNT_DELETION_IDENTITY } from "./guard-runtime-db-env.mjs";
import {
  parseExactPostgresUrl, assertExplicitPostgresConnectionAuthority,
  assertReviewedPostgresConnectionParameters, parseCanonicalPostgresDatabaseName,
} from "./postgres-url-safety.mjs";
import {
  ACCOUNT_DELETION_BOOTSTRAP_ROLE, buildAccountDeletionBootstrapSql, readAccountDeletionBootstrapLoginSnapshot,
  validateAccountDeletionBootstrapState,
} from "./account-deletion-worker-role-bootstrap.mjs";

const TARGET = REVIEWED_PRODUCTION_ACCOUNT_DELETION_IDENTITY;
const directHost = `${TARGET.endpointId}.${TARGET.region}.neon.tech`;
const pooledHost = `${TARGET.endpointId}-pooler.${TARGET.region}.neon.tech`;
const stopped = () => new Error("account deletion bootstrap connection refused or failed; preserve the exact private attempt");

export function accountDeletionBootstrapConnectionConfig(value, role, env = process.env) {
  try {
    assert.ok(env && typeof env === "object");
    // Explicit config is not permission to inherit alternate trust or startup
    // settings. Do not print the offending key/value or mutate process.env.
    assert.ok(!Object.keys(env).some(key =>
      /^(?:PG|NODE_OPTIONS$|NODE_TLS_REJECT_UNAUTHORIZED$|NODE_EXTRA_CA_CERTS$|SSL_CERT_FILE$|SSL_CERT_DIR$)/iu.test(key)));
    assert.ok(role === "neondb_owner" || role === ACCOUNT_DELETION_BOOTSTRAP_ROLE);
    assert.ok(typeof value === "string" && !/[\s\u0000-\u001f\u007f]/u.test(value));
    const url = parseExactPostgresUrl(value, "account deletion bootstrap connection");
    const authority = assertExplicitPostgresConnectionAuthority(url, "account deletion bootstrap connection");
    assertReviewedPostgresConnectionParameters(url, "account deletion bootstrap connection");
    assert.ok(parseCanonicalPostgresDatabaseName(url, "account deletion bootstrap connection") === TARGET.databaseName &&
      authority.username === role && url.username === role &&
      url.hostname === (role === "neondb_owner" ? directHost : pooledHost) &&
      url.searchParams.get("channel_binding") === "require");
    // Do not pass connectionString: pg would merge URL options into config.
    return Object.freeze({ host: url.hostname, port: 5432, database: TARGET.databaseName,
      user: role, password: decodeURIComponent(url.password),
      ssl: Object.freeze({ rejectUnauthorized: true }), enableChannelBinding: true,
      connectionTimeoutMillis: 10000, query_timeout: 20000,
      statement_timeout: 15000, lock_timeout: 5000,
      application_name: "grainline-account-deletion-bootstrap", options: "", keepAlive: true,
    });
  } catch { throw stopped(); }
}

// pg's enableChannelBinding is a preference, not a requirement. These narrow
// hooks reject downgrade BEFORE sending an authentication response. Keep real
// driver regression coverage: these methods are pg implementation interfaces.
export class AccountDeletionBootstrapPgClient extends pg.Client {
  #plusVerified = false;
  _handleAuthCleartextPassword() { this.connection.emit("error", stopped()); }
  _handleAuthMD5Password() { this.connection.emit("error", stopped()); }
  _handleAuthSASL(message) {
    if (this.enableChannelBinding !== true || this.connection.stream?.encrypted !== true ||
      this.connection.stream.authorized !== true || !message?.mechanisms?.includes("SCRAM-SHA-256-PLUS")) {
      this.connection.emit("error", stopped());
      return;
    }
    super._handleAuthSASL(message);
  }
  _handleAuthSASLFinal(message) {
    if (this.saslSession?.mechanism !== "SCRAM-SHA-256-PLUS") {
      this.connection.emit("error", stopped());
      return;
    }
    super._handleAuthSASLFinal(message);
    this.#plusVerified = this.saslSession === null;
  }
  _handleReadyForQuery(message) {
    if (this._connecting && !this.#plusVerified) {
      this.connection.emit("error", stopped());
      return;
    }
    super._handleReadyForQuery(message);
  }
}

const OWNER_IDENTITY_SQL = `SELECT current_user::text AS actor, session_user::text AS login,
  current_database()::text AS database, pg_catalog.current_setting('server_version_num')::integer AS version`;

async function freshConnection(config, work, Client) {
  let client;
  let asynchronousError = false;
  try {
    client = new Client(config);
    client.on("error", () => { asynchronousError = true; });
    await client.connect();
    const result = await work(client);
    assert.ok(!asynchronousError);
    return result;
  } catch { throw stopped(); }
  // Every invocation gets its own non-pooled client; end also discards an
  // aborted owner transaction if SQL or ROLLBACK cannot reach the server.
  finally {
    if (client) {
      try { await client.end(); } catch { throw stopped(); }
    }
  }
}

export function accountDeletionBootstrapConnectionOperations({ ownerUrl, state: rawState, binding,
  env = process.env, Client = AccountDeletionBootstrapPgClient }) {
  const state = validateAccountDeletionBootstrapState(rawState, binding);
  const ownerConfig = accountDeletionBootstrapConnectionConfig(ownerUrl, "neondb_owner", env);
  const workerUrl = new URL(`postgresql://${ACCOUNT_DELETION_BOOTSTRAP_ROLE}@${pooledHost}:5432/${TARGET.databaseName}?sslmode=verify-full&channel_binding=require`);
  workerUrl.password = state.password;
  const workerConfig = accountDeletionBootstrapConnectionConfig(workerUrl.toString(), ACCOUNT_DELETION_BOOTSTRAP_ROLE, env);
  const exactSql = buildAccountDeletionBootstrapSql(state, binding);
  return Object.freeze({
    async executeOwnerTransaction(sql) {
      assert.ok(sql === exactSql, "account deletion bootstrap SQL is not the exact private attempt");
      return freshConnection(ownerConfig, async client => {
        const result = await client.query(OWNER_IDENTITY_SQL);
        const row = result.rows[0];
        assert.ok(result.rows.length === 1 && row.actor === "neondb_owner" && row.login === "neondb_owner" &&
          row.database === TARGET.databaseName && Number.isInteger(row.version) && row.version >= 160000,
        "account deletion bootstrap owner identity or server version is invalid");
        try {
          await client.query("BEGIN");
          // Bind the private password without placing it in query text, argv,
          // evidence or client error output. Only this transaction can read it.
          const installed = await client.query(
            "SELECT pg_catalog.set_config('grainline.account_deletion_bootstrap_password', $1, true) IS NOT NULL AS installed",
            [state.password],
          );
          assert.ok(installed.rows.length === 1 && installed.rows[0].installed === true);
          await client.query(sql);
          await client.query("COMMIT");
        }
        catch {
          try { await client.query("ROLLBACK"); } catch { /* Fresh client is discarded below. */ }
          throw stopped();
        }
      }, Client);
    },
    async proveSeparateLogin(password) {
      assert.ok(password === state.password, "account deletion bootstrap login must reuse the private attempt");
      return freshConnection(workerConfig, readAccountDeletionBootstrapLoginSnapshot, Client);
    },
  });
}
