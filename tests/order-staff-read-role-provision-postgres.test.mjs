import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import pg from "pg";

const databaseUrl = process.env.ORDER_STAFF_READ_ROLE_PROVISION_PROOF_DATABASE_URL;
const STAFF_ROLE = "grainline_staff_read_runtime";

function staffUrl(value) {
  const parsed = new URL(value);
  parsed.username = STAFF_ROLE;
  parsed.password = "ci-staff-read-password";
  return parsed.toString();
}

test(
  "staff-read role convergence proves exact authority through a real login",
  { skip: !databaseUrl },
  async () => {
    const owner = new pg.Client({ connectionString: databaseUrl });
    await owner.connect();
    let created = false;
    try {
      const before = await owner.query(
        "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
        [STAFF_ROLE],
      );
      assert.equal(before.rowCount, 0, "CI staff proof role must start absent");
      await owner.query(`
        CREATE ROLE grainline_staff_read_runtime
          LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE
          NOREPLICATION PASSWORD 'ci-staff-read-password'
      `);
      created = true;

      const result = spawnSync("psql", [
        databaseUrl,
        "-v", `staff_role=${STAFF_ROLE}`,
        "-v", "runtime_role=grainline_app_runtime",
        "-v", "migration_role=ci",
        "-f", "scripts/provision-order-staff-read-role.sql",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, PGSSLROOTCERT: "system" },
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
      });
      assert.equal(
        result.status,
        0,
        `staff role convergence failed: ${result.stderr}`,
      );

      const posture = (await owner.query(`
        SELECT
          role.rolsuper, role.rolcreatedb, role.rolcreaterole,
          role.rolinherit, role.rolcanlogin, role.rolreplication,
          role.rolbypassrls,
          pg_catalog.has_schema_privilege($1, 'public', 'USAGE') AS schema_usage,
          pg_catalog.has_schema_privilege($1, 'public', 'CREATE') AS schema_create,
          pg_catalog.has_table_privilege($1, 'public."Order"', 'SELECT') AS order_select,
          pg_catalog.has_function_privilege(
            $1,
            'public.grainline_order_staff_page_v2(text,text,integer,integer)',
            'EXECUTE'
          ) AS page_execute,
          pg_catalog.has_function_privilege(
            $1,
            'public.grainline_order_staff_detail_v2(text,text)',
            'EXECUTE'
          ) AS detail_execute,
          pg_catalog.has_function_privilege(
            $1,
            'public.grainline_order_staff_page(text,text,integer,integer)',
            'EXECUTE'
          ) AS predecessor_execute
        FROM pg_catalog.pg_roles AS role
        WHERE role.rolname = $1
      `, [STAFF_ROLE])).rows[0];
      assert.deepEqual(posture, {
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolinherit: false,
        rolcanlogin: true,
        rolreplication: false,
        rolbypassrls: false,
        schema_usage: true,
        schema_create: false,
        order_select: false,
        page_execute: true,
        detail_execute: true,
        predecessor_execute: false,
      });

      const staff = new pg.Client({ connectionString: staffUrl(databaseUrl) });
      await staff.connect();
      try {
        assert.equal(
          (await staff.query("SELECT current_user AS value")).rows[0]?.value,
          STAFF_ROLE,
        );
        await assert.rejects(
          staff.query('SELECT id FROM public."Order" LIMIT 1'),
          (error) => error?.code === "42501",
        );
        try {
          await staff.query(
            "SELECT * FROM public.grainline_order_staff_detail_v2($1, $2)",
            ["ci-missing-staff", "ci-missing-order"],
          );
        } catch (error) {
          assert.notEqual(error?.code, "42501");
          assert.doesNotMatch(String(error?.message), /session role/u);
        }
      } finally {
        await staff.end();
      }
    } finally {
      if (created) {
        await owner.query(`DROP OWNED BY ${STAFF_ROLE}`);
        await owner.query(`DROP ROLE ${STAFF_ROLE}`);
      }
      await owner.end();
    }
  },
);
