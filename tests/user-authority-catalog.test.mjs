import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { USER_AUTHORITY_GROUPS, USER_ISOLATED_STAFF_PRIVATE_FUNCTION_NAMES } from "../scripts/user-authority-catalog.mjs";
import { deriveGrantInventory, RUNTIME_PRIVATE_FUNCTIONS } from "../scripts/audit-runtime-db-grants.mjs";

const functions = USER_AUTHORITY_GROUPS.flatMap((group) => group.functions);

test("the explicit User catalog matches exact migration signatures and private partition", () => {
  assert.equal(functions.length, 44);
  assert.equal(new Set(functions.map(({ identity }) => identity)).size, 44);
  assert.equal(functions.filter(({ runtimeExecute }) => runtimeExecute).length, 34);
  assert.equal(USER_ISOLATED_STAFF_PRIVATE_FUNCTION_NAMES.length, 8);
  for (const group of USER_AUTHORITY_GROUPS) {
    const sql = readFileSync(`prisma/migrations/${group.migration}/migration.sql`, "utf8");
    const actual = [...sql.matchAll(/CREATE(?: OR REPLACE)? FUNCTION public\.(grainline_\w+)\s*\(([\s\S]*?)\)\s*RETURNS/g)]
      .map((match) => {
        const argumentsText = match[2].trim() ? match[2].split(",").map((argument) => argument.trim().replace(/^p_\w+\s+/, "").replace(/timestamp\(3\)/g, "timestamp without time zone")).join(", ") : "";
        return `${match[1]}(${argumentsText})`;
      }).sort();
    assert.deepEqual(actual, group.functions.map(({ identity }) => identity).sort(), group.migration);
    for (const entry of group.functions.filter(({ runtimeExecute }) => !runtimeExecute)) {
      assert.ok(RUNTIME_PRIVATE_FUNCTIONS.includes(entry.name), entry.name);
    }
  }
});

test("grant inventory does not count documentation or schema-qualified FROM as a PUBLIC revoke", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grainline-user-revoke-inventory-"));
  try {
    mkdirSync(path.join(root, "prisma/migrations/fixture"), { recursive: true });
    writeFileSync(path.join(root, "prisma/schema.prisma"), "model User {\n id String @id\n}\n");
    writeFileSync(path.join(root, "prisma/migrations/fixture/migration.sql"), `
-- This function does not revoke table grants.
CREATE FUNCTION public.grainline_fixture() RETURNS bigint LANGUAGE sql AS $body$
 SELECT count(*) FROM public."User"
$body$;
-- A real public revoke follows.
REVOKE ALL ON FUNCTION public.grainline_fixture() FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
`);
    assert.deepEqual(deriveGrantInventory(root).publicRevokes, [
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
      "REVOKE ALL ON FUNCTION public.grainline_fixture() FROM PUBLIC",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("actual User provisioning SQL converges all 44 function grants and retains staff isolation", async () => {
  const database = new PGlite();
  try {
    await database.exec("CREATE ROLE grainline_app_runtime; CREATE ROLE grainline_staff_read_runtime;");
    for (const entry of functions) {
      await database.exec(`CREATE FUNCTION public.${entry.identity} RETURNS integer LANGUAGE sql AS 'SELECT 1';`);
    }
    await database.exec("REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO grainline_app_runtime;");
    for (const name of USER_ISOLATED_STAFF_PRIVATE_FUNCTION_NAMES) {
      const entry = functions.find((item) => item.name === name);
      await database.exec(`GRANT EXECUTE ON FUNCTION public.${entry.identity} TO grainline_staff_read_runtime;`);
    }
    const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
    const blocks = [...provision.matchAll(/WITH (?:private_trigger|user_isolated_staff_private|user_identity_owner_delivery_runtime|user_staff_ban_runtime|user_account_deletion_runtime|user_relationship_runtime)\(function_signature\) AS \([\s\S]*?;(?=\n\\gexec)/g)];
    assert.equal(blocks.length, 11);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      for (const [sql] of blocks) {
        const commands = await database.query(sql.replace(/:'runtime_role'/g, "'grainline_app_runtime'"));
        for (const row of commands.rows) await database.exec(Object.values(row)[0]);
      }
      for (const entry of functions) {
        const grants = await database.query(`SELECT has_function_privilege('grainline_app_runtime', $1, 'EXECUTE') AS runtime, has_function_privilege('grainline_staff_read_runtime', $1, 'EXECUTE') AS staff`, [`public.${entry.identity}`]);
        assert.equal(grants.rows[0].runtime, entry.runtimeExecute, entry.identity);
        if (USER_ISOLATED_STAFF_PRIVATE_FUNCTION_NAMES.includes(entry.name)) assert.equal(grants.rows[0].staff, true, entry.identity);
      }
    }
  } finally {
    await database.close();
  }
});
