import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assertZeroDirectRoles, readZeroDirectRoles } from "../scripts/order-zero-direct-release-roles.mjs";
import { zeroDirectRoleFixture } from "./helpers/order-zero-direct-role-fixture.mjs";

test("owner and every restricted login have exact attributes, with optional dormant staff", () => {
  for (const mode of ["production", "disposable"]) for (const staff of [false, true]) {
    const snapshot = zeroDirectRoleFixture(mode, staff);
    assertZeroDirectRoles(snapshot, mode);
    for (let i = 0; i < snapshot.roles.length; i += 1) {
      const missing = structuredClone(snapshot); missing.roles.splice(i, 1);
      if (snapshot.roles[i].name !== "grainline_staff_read_runtime")
        assert.throws(() => assertZeroDirectRoles(missing, mode));
      for (const [key, value] of Object.entries(snapshot.roles[i])) {
        const drift = structuredClone(snapshot); drift.roles[i][key] = typeof value === "boolean" ? !value : "unknown";
        assert.throws(() => assertZeroDirectRoles(drift, mode));
      }
    }
    const duplicate = structuredClone(snapshot); duplicate.roles.push(duplicate.roles[0]);
    assert.throws(() => assertZeroDirectRoles(duplicate, mode));
  }
  for (const value of [undefined, null, {}]) assert.throws(() => assertZeroDirectRoles(value, "production"));
  assert.throws(() => assertZeroDirectRoles(zeroDirectRoleFixture(), "bypass"));
});

test("only exact non-effective bootstrap edges survive; direct, transitive and cyclic membership drift fails", () => {
  const base = zeroDirectRoleFixture("production", true);
  for (let i = 0; i < base.edges.length; i += 1) {
    const missing = structuredClone(base); missing.edges.splice(i, 1);
    assert.throws(() => assertZeroDirectRoles(missing, "production"));
    const duplicate = structuredClone(base); duplicate.edges.push(duplicate.edges[i]);
    assert.throws(() => assertZeroDirectRoles(duplicate, "production"));
    for (const [key, value] of Object.entries(base.edges[i])) {
      // Existing owner guard binds neon_superuser options, not its provider grantor.
      if (key === "grantor" && base.edges[i].role === "neon_superuser") continue;
      const drift = structuredClone(base); drift.edges[i][key] = typeof value === "boolean" ? !value : "other";
      assert.throws(() => assertZeroDirectRoles(drift, "production"));
    }
  }
  for (const role of base.roles.filter(r => r.name !== "neondb_owner").map(r => r.name)) {
    for (const [member, parent] of [[role, "pg_read_all_data"], ["outsider", role], ["outsider", "neondb_owner"], [role, role]]) {
      const drift = structuredClone(base);
      drift.edges.push({ member, role: parent, grantor: "cloud_admin", admin: false, inherit: false, set: false });
      assert.throws(() => assertZeroDirectRoles(drift, "production"));
    }
  }
  const disposable = zeroDirectRoleFixture("disposable");
  disposable.edges.push({ member: "ci", role: "grainline_app_runtime", grantor: "ci", admin: true, inherit: false, set: false });
  assert.throws(() => assertZeroDirectRoles(disposable, "disposable"));
});

test("actual PostgreSQL role catalog rejects real membership and privilege changes", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE ci SUPERUSER LOGIN CREATEDB CREATEROLE REPLICATION BYPASSRLS;
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
      CREATE ROLE grainline_direct_upload_cleanup_v2 LOGIN NOINHERIT NOBYPASSRLS;
      CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT NOBYPASSRLS;
      CREATE ROLE outsider; SET SESSION AUTHORIZATION ci;`);
    assertZeroDirectRoles(await readZeroDirectRoles(db, "ci"), "disposable");
    for (const sql of [
      "ALTER ROLE grainline_app_runtime BYPASSRLS",
      "ALTER ROLE grainline_direct_upload_cleanup_v2 INHERIT",
      "ALTER ROLE grainline_staff_read_runtime CREATEROLE",
      "GRANT pg_read_all_data TO grainline_app_runtime WITH INHERIT FALSE, SET FALSE",
      "GRANT grainline_app_runtime TO outsider WITH INHERIT FALSE, SET FALSE",
      "GRANT grainline_staff_read_runtime TO outsider WITH INHERIT FALSE, SET FALSE",
    ]) {
      await db.exec("BEGIN");
      try {
        await db.exec(sql);
        const drift = await readZeroDirectRoles(db, "ci");
        assert.throws(() => assertZeroDirectRoles(drift, "disposable"));
      } finally { await db.exec("ROLLBACK"); }
      assertZeroDirectRoles(await readZeroDirectRoles(db, "ci"), "disposable");
    }
  } finally { await db.close(); }
});
