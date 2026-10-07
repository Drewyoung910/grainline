import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const provision = readFileSync("scripts/provision-order-staff-read-role.sql", "utf8");
const historical = execFileSync("git", [
  "show",
  "66746f47e87a73a6efce2ee6833542be5a86cc57:scripts/provision-order-staff-read-role.sql",
], { encoding: "utf8", env: { PATH: process.env.PATH } });
function requiredOperations(script) {
  const start = script.indexOf("WITH required(function_signature) AS (");
  const end = script.indexOf("\n\\gset", start);
  assert.ok(start >= 0 && end > start);
  return script.slice(start, end);
}
const start = provision.indexOf("WITH table_authority AS (");
const end = provision.indexOf("\n\\gset", start);
assert.ok(start >= 0 && end > start);
const catalog = provision.slice(start, end)
  .replaceAll(":'staff_role'", "'grainline_staff_read_runtime'")
  .replaceAll(":'runtime_role'", "'grainline_app_runtime'");

test("historical six-operation database rejects the newer staff script until User functions exist", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE FUNCTION public.grainline_order_staff_page_v2(text,text,integer,integer)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_order_staff_detail_v2(text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_order_staff_mark_reviewed(text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_order_staff_record_label_voided(text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_order_staff_append_note(text,text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_order_staff_capability_mint(text,text,text,jsonb)
        RETURNS text LANGUAGE sql SECURITY DEFINER AS 'SELECT NULL::text';
    `);
    const refusal = (await database.query(requiredOperations(provision))).rows[0];
    assert.equal(refusal.grainline_staff_role_failed, true);
    assert.match(refusal.grainline_staff_role_failure, /^missing staff operation: public\."grainline_user_/);
    assert.deepEqual((await database.query(requiredOperations(historical))).rows, [{
      grainline_staff_role_failed: false, grainline_staff_role_failure: "",
    }]);
  } finally {
    await database.close();
  }
});

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
      CREATE FUNCTION public.grainline_order_staff_mark_reviewed(text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_order_staff_record_label_voided(text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_order_staff_append_note(text,text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_order_staff_capability_mint(text,text,text,jsonb)
        RETURNS text LANGUAGE sql SECURITY DEFINER AS 'SELECT ''00000000-0000-4000-8000-000000000000''';
      CREATE FUNCTION public.grainline_user_staff_directory_count(text,text)
        RETURNS bigint LANGUAGE sql SECURITY DEFINER AS 'SELECT 0::bigint';
      CREATE FUNCTION public.grainline_user_staff_directory_page(text,text,integer)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_user_staff_exact_email_target(text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_user_staff_report_labels(text,text[])
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_user_staff_email_recipient(text,text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_user_staff_ban_target(text,text)
        RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      CREATE FUNCTION public.grainline_user_staff_capability_mint(text,text,text,timestamp without time zone)
        RETURNS text LANGUAGE sql SECURITY DEFINER AS 'SELECT ''00000000-0000-4000-8000-000000000000''';
      CREATE FUNCTION public.grainline_user_ban_repair_target(text,text)
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
      grainline_staff_role_failure: "staff operation execution authority is not exact",
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
