import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { newStaffBootstrapState, buildStaffBootstrapSql, STAFF_BOOTSTRAP_ROLE, readStaffBootstrapLoginSnapshot, staffBootstrapMarker } from "../scripts/order-staff-read-role-bootstrap.mjs";

const binding = { releaseCommit: "a".repeat(40), ciRunId: "34010014880" };

// SQL/transaction proof only. This fixture does not model Neon's bootstrap
// hook or prove authentication through a network login.
test("disposable PostgreSQL proves role bootstrap, replay, and fail-closed rollback", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE neondb_owner LOGIN SUPERUSER;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      CREATE TABLE public.staff_bootstrap_fixture(id integer);
      SET SESSION AUTHORIZATION neondb_owner;`);
    const state = newStaffBootstrapState(binding);
    const execute = async attempt => {
      await db.exec("BEGIN");
      const installed = await db.query(
        "SELECT pg_catalog.set_config('grainline.staff_bootstrap_password', $1, true) IS NOT NULL AS installed",
        [attempt.password],
      );
      assert.equal(installed.rows[0].installed, true);
      await db.exec(buildStaffBootstrapSql(attempt, binding));
      await db.exec("COMMIT");
    };
    const roleCount = async () => (await db.query(`SELECT count(*)::integer AS n
      FROM pg_catalog.pg_roles WHERE rolname = '${STAFF_BOOTSTRAP_ROLE}'`)).rows[0].n;

    // Ambient PUBLIC privileges must abort creation, not require later repair.
    await db.exec("GRANT SELECT ON public.staff_bootstrap_fixture TO PUBLIC");
    await assert.rejects(execute(state), /retains application authority/u);
    await db.exec("ROLLBACK");
    assert.equal(await roleCount(), 0);
    await db.exec("REVOKE SELECT ON public.staff_bootstrap_fixture FROM PUBLIC");

    await execute(state);
    const firstOid = (await db.query(`SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname = '${STAFF_BOOTSTRAP_ROLE}'`)).rows[0].oid;
    const firstVerifier = (await db.query(`SELECT rolpassword FROM pg_catalog.pg_authid
      WHERE rolname = '${STAFF_BOOTSTRAP_ROLE}'`)).rows[0].rolpassword;
    assert.match(firstVerifier, /^SCRAM-SHA-256\$/u);
    await execute(state);
    assert.equal((await db.query(`SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname = '${STAFF_BOOTSTRAP_ROLE}'`)).rows[0].oid, firstOid);
    const otherCredential = newStaffBootstrapState(binding);
    await execute({ ...state, password: otherCredential.password,
      verifier: otherCredential.verifier });
    assert.equal((await db.query(`SELECT rolpassword = $1 AS unchanged FROM pg_catalog.pg_authid
      WHERE rolname = '${STAFF_BOOTSTRAP_ROLE}'`, [firstVerifier])).rows[0].unchanged, true);
    const role = (await db.query(`SELECT rolsuper, rolcreatedb, rolcreaterole,
      rolinherit, rolcanlogin, rolreplication, rolbypassrls FROM pg_catalog.pg_roles
      WHERE rolname = '${STAFF_BOOTSTRAP_ROLE}'`)).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false,
      rolinherit: false, rolcanlogin: true, rolreplication: false, rolbypassrls: false });

    await assert.rejects(execute(newStaffBootstrapState(binding)), /existing unbound role/u);
    await db.exec("ROLLBACK");
    await db.exec(`ALTER ROLE ${STAFF_BOOTSTRAP_ROLE} BYPASSRLS`);
    await assert.rejects(execute(state), /attributes drifted/u);
    await db.exec(`ROLLBACK; ALTER ROLE ${STAFF_BOOTSTRAP_ROLE} NOBYPASSRLS;
      GRANT SELECT(id) ON public.staff_bootstrap_fixture TO ${STAFF_BOOTSTRAP_ROLE};`);
    await assert.rejects(execute(state), /retains application authority/u);
    await db.exec(`ROLLBACK; REVOKE SELECT(id) ON public.staff_bootstrap_fixture FROM ${STAFF_BOOTSTRAP_ROLE}`);
    for (const [setup, undo, message] of [
      [`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${STAFF_BOOTSTRAP_ROLE}`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM ${STAFF_BOOTSTRAP_ROLE}`,
        /owns objects or default grants/u],
      [`CREATE ROLE staff_bootstrap_parent; GRANT staff_bootstrap_parent TO ${STAFF_BOOTSTRAP_ROLE}`,
        `REVOKE staff_bootstrap_parent FROM ${STAFF_BOOTSTRAP_ROLE}; DROP ROLE staff_bootstrap_parent`,
        /membership drifted/u],
      [`CREATE ROLE staff_bootstrap_member; GRANT ${STAFF_BOOTSTRAP_ROLE} TO staff_bootstrap_member`,
        `REVOKE ${STAFF_BOOTSTRAP_ROLE} FROM staff_bootstrap_member; DROP ROLE staff_bootstrap_member`,
        /membership drifted/u],
      [`ALTER TABLE public.staff_bootstrap_fixture OWNER TO ${STAFF_BOOTSTRAP_ROLE}`,
        "ALTER TABLE public.staff_bootstrap_fixture OWNER TO neondb_owner", /owns objects or default grants/u],
      ["CREATE FUNCTION public.staff_bootstrap_leak() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'",
        "DROP FUNCTION public.staff_bootstrap_leak()", /retains application authority/u],
    ]) {
      await db.exec(setup);
      await assert.rejects(execute(state), message);
      await db.exec("ROLLBACK");
      await db.exec(undo);
    }
    await execute(state);
    assert.equal(await roleCount(), 1);
    await db.exec(`SET SESSION AUTHORIZATION ${STAFF_BOOTSTRAP_ROLE}`);
    const snapshot = await readStaffBootstrapLoginSnapshot(db);
    assert.equal(snapshot.currentUser, STAFF_BOOTSTRAP_ROLE);
    assert.equal(snapshot.sessionUser, STAFF_BOOTSTRAP_ROLE);
    assert.equal(snapshot.marker, staffBootstrapMarker(state));
    assert.equal(snapshot.restrictedRole, true);
    assert.equal(snapshot.hasApplicationAuthority, false);
  } finally { await db.close(); }
});
