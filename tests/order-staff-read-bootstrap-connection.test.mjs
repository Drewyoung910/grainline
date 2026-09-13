import assert from "node:assert/strict";
import test from "node:test";
import {
  staffBootstrapConnectionConfig, StaffBootstrapPgClient, staffBootstrapConnectionOperations,
} from "../scripts/order-staff-read-bootstrap-connection.mjs";
import {
  newStaffBootstrapState, buildStaffBootstrapSql, STAFF_BOOTSTRAP_ROLE, staffBootstrapMarker,
} from "../scripts/order-staff-read-role-bootstrap.mjs";

const ownerUrl = "postgresql://neondb_owner:dummy-test-password@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const binding = { releaseCommit: "a".repeat(40), ciRunId: "34010014880" };
const refusal = /staff bootstrap connection refused or failed/u;

test("bootstrap connection pins role, direct endpoint, strict TLS, timeouts and explicit config", () => {
  const config = staffBootstrapConnectionConfig(ownerUrl, "neondb_owner", {});
  assert.equal(config.host, "ep-plain-river-aaqg8gj4.westus3.azure.neon.tech");
  assert.equal(config.port, 5432);
  assert.equal(config.database, "neondb");
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.enableChannelBinding, true);
  assert.equal(config.connectionString, undefined);
  assert.equal(config.options, "");
  assert.equal(config.query_timeout, 20000);
  assert.equal(config.statement_timeout, 15000);
  assert.equal(config.lock_timeout, 5000);
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.ssl));
});

test("wrong target, URL overrides, missing binding and ambient trust/startup settings fail closed", () => {
  for (const change of [
    value => value.replace("neondb_owner", "grainline_app_runtime"),
    value => value.replace("aaqg8gj4.", "aaqg8gj4-pooler."),
    value => value.replace("/neondb?", "/other?"),
    value => value.replace("/neondb?", "/%6eeondb?"),
    value => value.replace(":5432/", ":5433/"),
    value => value.replace(":5432/", "/"),
    value => value.replace("verify-full", "require"),
    value => value.replace("&channel_binding=require", ""),
    value => value.replace("channel_binding=require", "channel_binding=prefer"),
    value => value + "&sslmode=verify-full",
    value => value + "&options=-crole%3Dneondb_owner",
    value => value + "&sslrootcert=/tmp/untrusted",
    value => value + "#ignored",
    value => value.replace("ep-plain", "ep-\nplain"),
  ]) assert.throws(() => staffBootstrapConnectionConfig(change(ownerUrl), "neondb_owner", {}), refusal);
  for (const key of ["PGHOST", "PGPORT", "PGDATABASE", "PGPASSWORD", "PGSSLMODE", "PGOPTIONS",
    "PGSERVICE", "PGPASSFILE", "NODE_OPTIONS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"]) {
    assert.throws(() => staffBootstrapConnectionConfig(ownerUrl, "neondb_owner", { [key]: "" }), refusal);
  }
});

function mockTransport(state, injected = {}) {
  const clients = [];
  class Client {
    constructor(config) { this.config = config; this.calls = []; clients.push(this); }
    on() {}
    async connect() { this.calls.push("connect"); if (injected.connect) throw new Error(state.password); }
    async end() { this.calls.push("end"); if (injected.end) throw new Error(state.password); }
    async query(sql) {
      this.calls.push(sql);
      if (sql.includes("AS actor")) return { rows: [{ actor: "neondb_owner", login: "neondb_owner",
        database: "neondb", version: 160000, ...injected.identity }] };
      if (sql.includes("DO $staff_bootstrap$")) {
        if (injected.sql) throw new Error(state.password);
        return { rows: [] };
      }
      if (sql === "ROLLBACK" && injected.rollback) throw new Error(state.password);
      return { rows: [{ current_user_name: STAFF_BOOTSTRAP_ROLE, session_user_name: STAFF_BOOTSTRAP_ROLE,
        database_name: "neondb", marker: staffBootstrapMarker(state), read_only: true,
        attributes_valid: true, memberships_valid: true, ownership_valid: true, has_application_authority: false }] };
    }
  }
  return { Client, clients };
}

test("each owner or pooled staff proof uses a fresh client and closes it", async () => {
  const state = newStaffBootstrapState(binding);
  const mock = mockTransport(state);
  const operations = staffBootstrapConnectionOperations({ ownerUrl, state, binding, env: {}, Client: mock.Client });
  await operations.executeOwnerTransaction(buildStaffBootstrapSql(state, binding));
  const snapshot = await operations.proveSeparateLogin(state.password);
  await operations.proveSeparateLogin(state.password);
  assert.equal(snapshot.currentUser, STAFF_BOOTSTRAP_ROLE);
  assert.equal(mock.clients.length, 3);
  assert.ok(mock.clients.every(client => client.calls.at(-1) === "end"));
  assert.equal(mock.clients[1].config.host, "ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech");
  assert.equal(mock.clients[1].config.user, STAFF_BOOTSTRAP_ROLE);
  assert.ok(mock.clients[1].config.password === state.password);
  assert.match(mock.clients[1].calls[1], /REPEATABLE READ READ ONLY/u);
  assert.equal(mock.clients[1].calls.at(-2), "ROLLBACK");
});

test("identity drift never reaches creation; SQL failure rolls back and discards even when rollback fails", async () => {
  for (const injected of [{ identity: { login: "ci" } }, { identity: { database: "other" } },
    { identity: { version: 150000 } }, { sql: true }, { sql: true, rollback: true }, { connect: true }, { end: true }]) {
    const state = newStaffBootstrapState(binding);
    const mock = mockTransport(state, injected);
    const operations = staffBootstrapConnectionOperations({ ownerUrl, state, binding, env: {}, Client: mock.Client });
    await assert.rejects(operations.executeOwnerTransaction(buildStaffBootstrapSql(state, binding)), error => {
      assert.match(error.message, refusal);
      assert.ok(!error.message.includes(state.password));
      assert.equal(error.cause, undefined);
      return true;
    });
    const calls = mock.clients[0].calls;
    assert.equal(calls.at(-1), "end");
    if (injected.identity || injected.connect) assert.ok(!calls.some(sql => sql.includes("DO $staff_bootstrap$")));
    if (injected.sql) assert.equal(calls.at(-2), "ROLLBACK");
  }
});

test("SQL or credential substitution is rejected before constructing a connection", async () => {
  const state = newStaffBootstrapState(binding);
  const mock = mockTransport(state);
  const operations = staffBootstrapConnectionOperations({ ownerUrl, state, binding, env: {}, Client: mock.Client });
  await assert.rejects(operations.executeOwnerTransaction("DROP ROLE unrelated"), /exact private attempt/u);
  await assert.rejects(operations.proveSeparateLogin("replacement"), /reuse the private attempt/u);
  assert.equal(mock.clients.length, 0);
});

test("installed pg driver cannot downgrade bootstrap authentication or accept trust-only ReadyForQuery", () => {
  for (const request of ["cleartext", "md5", "no-plus", "no-tls", "untrusted-tls", "trust"]) {
    const client = new StaffBootstrapPgClient({ user: "fixture", password: "dummy", enableChannelBinding: true });
    const errors = [];
    let responseSent = false;
    client.connection.on("error", error => errors.push(error));
    client.connection.password = () => { responseSent = true; };
    client.connection.sendSASLInitialResponseMessage = () => { responseSent = true; };
    client.connection.stream.encrypted = request !== "no-tls";
    client.connection.stream.authorized = request !== "untrusted-tls";
    if (request === "cleartext") client._handleAuthCleartextPassword();
    else if (request === "md5") client._handleAuthMD5Password({ salt: Buffer.alloc(4) });
    else if (request === "trust") {
      client._connecting = true;
      client._handleReadyForQuery({});
    } else client._handleAuthSASL({ mechanisms: request === "no-plus" ? ["SCRAM-SHA-256"] : ["SCRAM-SHA-256-PLUS"] });
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, refusal);
    assert.equal(responseSent, false);
    client.connection.stream.destroy();
  }
});

test("installed pg driver chooses PLUS only on verified TLS and rejects an invalid final signature", () => {
  const client = new StaffBootstrapPgClient({ user: "fixture", password: "dummy", enableChannelBinding: true });
  const errors = [];
  client.connection.on("error", error => errors.push(error));
  client.connection.stream.encrypted = true;
  client.connection.stream.authorized = true;
  client.connection.stream.getPeerCertificate = () => ({});
  let mechanism;
  client.connection.sendSASLInitialResponseMessage = (value) => { mechanism = value; };
  client._handleAuthSASL({ mechanisms: ["SCRAM-SHA-256", "SCRAM-SHA-256-PLUS"] });
  assert.equal(mechanism, "SCRAM-SHA-256-PLUS");
  client._handleAuthSASLFinal({ data: "v=wrong" });
  assert.equal(errors.length, 1);
  client._connecting = true;
  client._handleReadyForQuery({});
  assert.equal(errors.length, 2);
  client.connection.stream.destroy();
});

test("installed pg final-signature verification permits readiness only after valid PLUS", () => {
  const client = new StaffBootstrapPgClient({ user: "fixture", password: "dummy", enableChannelBinding: true });
  const errors = [];
  client.connection.on("error", error => errors.push(error));
  const signature = Buffer.alloc(32, 1).toString("base64");
  // This exercises the real pg final verifier and ReadyForQuery path. It is
  // deliberately NOT a claim of a network handshake or server authentication.
  client.saslSession = { mechanism: "SCRAM-SHA-256-PLUS", message: "SASLResponse", serverSignature: signature };
  client._handleAuthSASLFinal({ data: `v=${signature}` });
  client._connecting = true;
  let connected = false;
  client._connectionCallback = () => { connected = true; };
  client._handleReadyForQuery({});
  assert.equal(errors.length, 0);
  assert.equal(connected, true);
  assert.equal(client.readyForQuery, true);
  client.connection.stream.destroy();
});
