import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AccountDeletionBootstrapPgClient, accountDeletionBootstrapConnectionOperations } from "../scripts/account-deletion-worker-bootstrap-connection.mjs";
import { withAccountDeletionBootstrapJournal } from "../scripts/account-deletion-worker-bootstrap-journal.mjs";
import { newAccountDeletionBootstrapState, buildAccountDeletionBootstrapSql, ACCOUNT_DELETION_BOOTSTRAP_ROLE } from "../scripts/account-deletion-worker-role-bootstrap.mjs";
import { coordinateAccountDeletionBootstrap } from "../scripts/account-deletion-worker-bootstrap-coordinator.mjs";
import { accountDeletionReleaseFixture } from "./helpers/account-deletion-bootstrap-release-fixture.mjs";

const enabled = process.env.ACCOUNT_DELETION_WORKER_BOOTSTRAP_TLS_PROOF;
test("isolated PostgreSQL 16 proves TLS PLUS login, committed-response-loss restart and concurrent replay",
  { skip: !enabled, timeout: 60000 }, async () => {
    assert.equal(enabled, "loopback-ci-postgres16");
    const ca = fs.readFileSync(process.env.ACCOUNT_DELETION_WORKER_BOOTSTRAP_TLS_PROOF_CA, "utf8");
    // This harness NEVER resolves a production hostname. The production config
    // validator is exercised, then every socket is hardwired to its CI service.
    class LocalClient extends AccountDeletionBootstrapPgClient {
      constructor(config) {
        assert.ok(["neondb_owner", ACCOUNT_DELETION_BOOTSTRAP_ROLE].includes(config.user));
        super({ ...config, host: "127.0.0.1", port: 5432, database: "neondb",
          ssl: { rejectUnauthorized: true, ca }, enableChannelBinding: true });
      }
    }
    const ownerUrl = "postgresql://neondb_owner:ci-owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
    const admin = new LocalClient({ user: "neondb_owner", password: "ci-owner", connectionTimeoutMillis: 5000 });
    const binding = { releaseCommit: "a".repeat(40), ciRunId: "1" };
    const state = newAccountDeletionBootstrapState(binding);
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-account-deletion-tls-proof-")));
    fs.chmodSync(directory, 0o700);
    let roleCreated = false;
    try {
      await admin.connect();
      const identity = (await admin.query(`SELECT current_user AS actor, session_user AS login,
        current_database() AS database, pg_catalog.current_setting('server_version_num')::integer AS version`)).rows[0];
      assert.ok(identity.actor === "neondb_owner" && identity.login === "neondb_owner" && identity.database === "neondb" &&
        identity.version >= 160000 && identity.version < 170000);
      assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ACCOUNT_DELETION_BOOTSTRAP_ROLE])).rowCount, 0);
      const operations = accountDeletionBootstrapConnectionOperations({ ownerUrl, state, binding, env: {}, Client: LocalClient });
      // Observations here are explicitly fabricated main metadata. This proves
      // the coordinator with real database transport, not live GitHub/Vercel
      // collection or a production credential epoch.
      const release = accountDeletionReleaseFixture();
      release.reviewed.ciRunId = binding.ciRunId;
      release.ci.id = Number(binding.ciRunId);
      const coordinator = { reviewed: release.reviewed, directory, env: {},
        observeRelease: async () => release,
        loadOwnerCredential: async () => ({ url: ownerUrl, epochSha256: release.reviewed.credentialEpochSha256 }),
        connectionFactory: params => accountDeletionBootstrapConnectionOperations({ ...params, Client: LocalClient }),
      };
      await withAccountDeletionBootstrapJournal({ directory, binding }, journal => journal.persistPrivateState(state));
      await assert.rejects(coordinateAccountDeletionBootstrap({ ...coordinator,
        connectionFactory: params => ({ ...coordinator.connectionFactory(params),
          async executeOwnerTransaction(sql) {
            await operations.executeOwnerTransaction(sql);
            roleCreated = true;
            throw new Error("simulated lost committed response");
          },
        }),
      }), /preserve the exact private attempt/u);
      assert.equal(roleCreated, true);
      const initialOid = (await admin.query("SELECT oid FROM pg_roles WHERE rolname = $1", [ACCOUNT_DELETION_BOOTSTRAP_ROLE])).rows[0].oid;
      await withAccountDeletionBootstrapJournal({ directory, binding }, journal => {
        assert.equal(journal.read().stage, "create-pending");
      });
      assert.equal((await coordinateAccountDeletionBootstrap(coordinator)).status, "role-verified");
      await Promise.all([operations.executeOwnerTransaction(buildAccountDeletionBootstrapSql(state, binding)),
        operations.executeOwnerTransaction(buildAccountDeletionBootstrapSql(state, binding))]);
      assert.equal((await admin.query("SELECT oid FROM pg_roles WHERE rolname = $1", [ACCOUNT_DELETION_BOOTSTRAP_ROLE])).rows[0].oid, initialOid);

      // Different credential, same marker: creation replay must not reset it;
      // only the original credential can authenticate after the replay.
      const other = newAccountDeletionBootstrapState(binding);
      const changed = { ...state, password: other.password, verifier: other.verifier };
      const changedOperations = accountDeletionBootstrapConnectionOperations({ ownerUrl, state: changed, binding, env: {}, Client: LocalClient });
      await changedOperations.executeOwnerTransaction(buildAccountDeletionBootstrapSql(changed, binding));
      await assert.rejects(changedOperations.proveSeparateLogin(changed.password), /connection refused or failed/u);
      assert.equal((await operations.proveSeparateLogin(state.password)).restrictedRole, true);
      await coordinateAccountDeletionBootstrap({ ...coordinator,
        connectionFactory: params => ({ ...coordinator.connectionFactory(params),
          async executeOwnerTransaction() { assert.fail("terminal replay must not run SQL"); },
        }),
      });
    } finally {
      try {
        if (roleCreated) {
          await admin.query(`DROP ROLE ${ACCOUNT_DELETION_BOOTSTRAP_ROLE}`);
          assert.equal((await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ACCOUNT_DELETION_BOOTSTRAP_ROLE])).rowCount, 0);
        }
      } finally {
        await admin.end();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });
