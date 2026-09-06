import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StaffBootstrapPgClient, staffBootstrapConnectionOperations } from "../scripts/order-staff-read-bootstrap-connection.mjs";
import { withStaffBootstrapJournal } from "../scripts/order-staff-read-bootstrap-journal.mjs";
import { newStaffBootstrapState, buildStaffBootstrapSql, runStaffBootstrapCore, STAFF_BOOTSTRAP_ROLE } from "../scripts/order-staff-read-role-bootstrap.mjs";

const enabled = process.env.ORDER_STAFF_BOOTSTRAP_TLS_PROOF;
test("isolated PostgreSQL 16 proves TLS PLUS login, committed-response-loss restart and concurrent replay",
  { skip: !enabled, timeout: 60000 }, async () => {
    assert.equal(enabled, "loopback-ci-postgres16");
    const ca = fs.readFileSync(process.env.ORDER_STAFF_BOOTSTRAP_TLS_PROOF_CA, "utf8");
    // This harness NEVER resolves a production hostname. The production config
    // validator is exercised, then every socket is hardwired to its CI service.
    class LocalClient extends StaffBootstrapPgClient {
      constructor(config) {
        assert.ok(["neondb_owner", STAFF_BOOTSTRAP_ROLE].includes(config.user));
        super({ ...config, host: "127.0.0.1", port: 5432, database: "neondb",
          ssl: { rejectUnauthorized: true, ca }, enableChannelBinding: true });
      }
    }
    const ownerUrl = "postgresql://neondb_owner:ci-owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
    const admin = new LocalClient({ user: "neondb_owner", password: "ci-owner", connectionTimeoutMillis: 5000 });
    const binding = { releaseCommit: "a".repeat(40), ciRunId: "1" };
    const state = newStaffBootstrapState(binding);
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-staff-tls-proof-")));
    fs.chmodSync(directory, 0o700);
    let roleCreated = false;
    try {
      await admin.connect();
      const identity = (await admin.query(`SELECT current_user AS actor, session_user AS login,
        current_database() AS database, pg_catalog.current_setting('server_version_num')::integer AS version`)).rows[0];
      assert.ok(identity.actor === "neondb_owner" && identity.login === "neondb_owner" && identity.database === "neondb" &&
        identity.version >= 160000 && identity.version < 170000);
      assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [STAFF_BOOTSTRAP_ROLE])).rowCount, 0);
      const operations = staffBootstrapConnectionOperations({ ownerUrl, state, binding, env: {}, Client: LocalClient });
      await assert.rejects(withStaffBootstrapJournal({ directory, binding }, async journal => {
        journal.persistPrivateState(state);
        await runStaffBootstrapCore({ state, binding, operations: { ...operations,
          persistPrivateState: journal.persistPrivateState,
          async executeOwnerTransaction(sql) {
            await operations.executeOwnerTransaction(sql);
            roleCreated = true;
            throw new Error("simulated lost committed response");
          },
        } });
      }), /preserve files for exact-attempt recovery/u);
      assert.equal(roleCreated, true);
      const initialOid = (await admin.query("SELECT oid FROM pg_roles WHERE rolname = $1", [STAFF_BOOTSTRAP_ROLE])).rows[0].oid;
      await withStaffBootstrapJournal({ directory, binding }, async journal => {
        assert.equal(journal.read().stage, "create-pending");
        const result = await runStaffBootstrapCore({ state: journal.read(), binding,
          operations: { ...operations, persistPrivateState: journal.persistPrivateState } });
        assert.equal(result.status, "role-verified");
      });
      await Promise.all([operations.executeOwnerTransaction(buildStaffBootstrapSql(state, binding)),
        operations.executeOwnerTransaction(buildStaffBootstrapSql(state, binding))]);
      assert.equal((await admin.query("SELECT oid FROM pg_roles WHERE rolname = $1", [STAFF_BOOTSTRAP_ROLE])).rows[0].oid, initialOid);

      // Different credential, same marker: creation replay must not reset it;
      // only the original credential can authenticate after the replay.
      const other = newStaffBootstrapState(binding);
      const changed = { ...state, password: other.password, verifier: other.verifier };
      const changedOperations = staffBootstrapConnectionOperations({ ownerUrl, state: changed, binding, env: {}, Client: LocalClient });
      await changedOperations.executeOwnerTransaction(buildStaffBootstrapSql(changed, binding));
      await assert.rejects(changedOperations.proveSeparateLogin(changed.password), /connection refused or failed/u);
      assert.equal((await operations.proveSeparateLogin(state.password)).restrictedRole, true);
      await withStaffBootstrapJournal({ directory, binding }, async journal => {
        await runStaffBootstrapCore({ state: journal.read(), binding, operations: { ...operations,
          persistPrivateState: journal.persistPrivateState,
          async executeOwnerTransaction() { assert.fail("terminal replay must not run SQL"); },
        } });
      });
    } finally {
      try {
        if (roleCreated) {
          await admin.query(`DROP ROLE ${STAFF_BOOTSTRAP_ROLE}`);
          assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [STAFF_BOOTSTRAP_ROLE])).rowCount, 0);
        }
      } finally {
        await admin.end();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });
