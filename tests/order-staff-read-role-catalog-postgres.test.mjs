import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const provision = readFileSync("scripts/provision-order-staff-read-role.sql", "utf8");
const start = provision.indexOf("WITH table_authority AS (");
const end = provision.indexOf("\n\\gset", start);
assert.ok(start >= 0 && end > start);
const catalog = provision.slice(start, end)
  .replaceAll(":'staff_role'", "'grainline_staff_read_runtime'")
  .replaceAll(":'runtime_role'", "'grainline_app_runtime'");

test("staff grant final catalog executes in PostgreSQL and rejects PUBLIC leakage", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
      CREATE TABLE public.staff_proof_fixture (id integer);
      CREATE SEQUENCE public.staff_proof_sequence;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO grainline_staff_read_runtime;
      CREATE FUNCTION public.grainline_order_staff_page_v2(text,text,integer,integer)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_order_staff_detail_v2(text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO grainline_staff_read_runtime;
    `);
    assert.deepEqual((await database.query(catalog)).rows, [{
      grainline_staff_role_failed: false, grainline_staff_role_failure: "",
    }]);
    await database.exec(`GRANT EXECUTE ON FUNCTION
      public.grainline_order_staff_detail_v2(text,text) TO PUBLIC`);
    assert.deepEqual((await database.query(catalog)).rows, [{
      grainline_staff_role_failed: true,
      grainline_staff_role_failure: "staff projection execution authority is not exact",
    }]);
    await database.exec(`REVOKE EXECUTE ON FUNCTION
      public.grainline_order_staff_detail_v2(text,text) FROM PUBLIC;
      GRANT USAGE ON SEQUENCE public.staff_proof_sequence TO grainline_staff_read_runtime;`);
    assert.equal((await database.query(catalog)).rows[0].grainline_staff_role_failure,
      "staff role retains sequence authority");
  } finally {
    await database.close();
  }
});
