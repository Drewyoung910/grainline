import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createZeroDirectAuthorityInventory, readZeroDirectConfiguration, assertZeroDirectConfiguration, auditZeroDirectAuthority } from "../scripts/order-zero-direct-release-authority.mjs";
import { deriveGrantInventory, defaultPrivilegeRequirements } from "../scripts/audit-runtime-db-grants.mjs";
import { createOrderZeroDirectReleaseScope } from "../scripts/order-zero-direct-release-scope.mjs";

const scope = createOrderZeroDirectReleaseScope();
const states = createZeroDirectAuthorityInventory(scope.manifest);
const clean = { override_rows: 0, row_security_on: true, origin_replication: true,
  safe_search_path: true, standard_strings: true, read_only: true, repeatable_read: true };

test("all 18 global inventories preserve unaffected authority and omit only not-yet-created prefix objects", () => {
  const full = deriveGrantInventory();
  assert.deepEqual(states[17].inventory, full);
  assert.equal(full.tables.length, 67); assert.equal(full.functions.length, 265);
  for (let n = 0; n <= 17; n += 1) {
    const inventory = states[n].inventory;
    const excludedFunctions = scope.manifest.targetNames.filter(name => !scope.manifest.states[n].some(fn => fn.name === name));
    assert.deepEqual(inventory.functions, full.functions.filter(name => !excludedFunctions.includes(name)));
    assert.equal(inventory.tables.length, 65 + Number(n >= 10) + Number(n >= 12));
    for (const field of ["tables", "rlsEnableTables", "rlsForceTables"])
      for (const [name, introduced] of [["OrderStaffCapability", 10], ["SellerDeauthorizationApplication", 12]])
        assert.equal(inventory[field].includes(name), n >= introduced);
    for (const field of Object.keys(full).filter(key => !["functions", "tables", "rlsPolicyTables", "rlsEnableTables", "rlsForceTables"].includes(key)))
      assert.deepEqual(inventory[field], full[field], field);
    assert.match(states[n].sha256, /^[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(inventory.functions), true);
    assert.ok(inventory.rlsForceTables.includes("CheckoutStockReservation"));
    assert.ok(!inventory.rlsEnableTables.includes("Order"));
  }
  for (const patch of [{ base: [] }, { members: [] }, { states: [] }, { targetNames: [] }])
    assert.throws(() => createZeroDirectAuthorityInventory({ ...scope.manifest, ...patch }));
});

test("prefix inventories independently match the legacy audit derived from each exact source tree", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grainline-prefix-inventory-"));
  try {
    mkdirSync(path.join(root, "prisma", "migrations"), { recursive: true });
    copyFileSync("prisma/schema.prisma", path.join(root, "prisma", "schema.prisma"));
    const copy = row => {
      const directory = path.join(root, "prisma", "migrations", row.migration_name);
      mkdirSync(directory);
      copyFileSync(`prisma/migrations/${row.migration_name}/migration.sql`, path.join(directory, "migration.sql"));
    };
    scope.manifest.base.forEach(copy);
    for (let n = 0; n <= 17; n += 1) {
      if (n > 0) copy(scope.manifest.members[n - 1]);
      const independentlyDerived = deriveGrantInventory(root);
      for (const field of Object.keys(independentlyDerived).filter(key => !["publicRevokes", "publicDefaultPrivilegeRevokes"].includes(key)))
        assert.deepEqual(states[n].inventory[field], independentlyDerived[field], `${n}/${field}`);
      assert.deepEqual(defaultPrivilegeRequirements(states[n].inventory), defaultPrivilegeRequirements(independentlyDerived));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("configuration drift fails before the global audit and never includes raw setting values", async () => {
  for (const key of Object.keys(clean)) {
    const row = { ...clean, [key]: key === "override_rows" ? 1 : false };
    assert.throws(() => assertZeroDirectConfiguration(row));
    let queries = 0;
    const client = { query: async () => { queries += 1; return { rows: [row] }; } };
    await assert.rejects(auditZeroDirectAuthority(client, states[17], "ci"));
    assert.equal(queries, 1);
  }
  for (const row of [null, undefined, {}, { ...clean, extra: true }])
    assert.throws(() => assertZeroDirectConfiguration(row));
  const source = readFileSync("scripts/order-zero-direct-release-authority.mjs", "utf8");
  assert.doesNotMatch(source, /new (?:pg\.)?Client|process\.env|writeFile|execFile|ALTER ROLE|ALTER DATABASE/u);
  assert.match(source, /auditLiveDatabase\(\{ client, runtimeRole: "grainline_app_runtime"/u);
  // This component reads cardinality only, not any GUC value or password.
  assert.doesNotMatch(source, /unnest\(s\.setconfig\)|rolpassword|pg_authid/u);
});

test("real catalog configuration checks cover role-wide, database-wide and combined overrides", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE ci SUPERUSER; CREATE ROLE grainline_app_runtime;
      CREATE ROLE grainline_direct_upload_cleanup_v2; CREATE ROLE grainline_staff_read_runtime;
      CREATE ROLE unrelated; SET SESSION AUTHORIZATION ci;`);
    const database = (await db.query("SELECT current_database() AS name")).rows[0].name;
    assert.match(database, /^[a-z0-9_]+$/u);
    const read = async () => {
      await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try { return await readZeroDirectConfiguration(db, "ci"); }
      finally { await db.exec("ROLLBACK"); }
    };
    assertZeroDirectConfiguration(await read());
    for (const target of ["ROLE ci", "ROLE grainline_app_runtime", "ROLE grainline_direct_upload_cleanup_v2",
      "ROLE grainline_staff_read_runtime", `DATABASE "${database}"`, `ROLE grainline_app_runtime IN DATABASE "${database}"`]) {
      await db.exec(`ALTER ${target} SET application_name='synthetic-private-setting-value'`);
      try {
        const row = await read();
        assert.equal(row.override_rows, 1);
        assert.throws(() => assertZeroDirectConfiguration(row));
        assert.ok(!JSON.stringify(row).includes("synthetic-private-setting-value"));
      } finally { await db.exec(`ALTER ${target} RESET ALL`); }
      assertZeroDirectConfiguration(await read());
    }
    await db.exec("ALTER ROLE unrelated SET application_name='unrelated'");
    assertZeroDirectConfiguration(await read());
    await db.exec("SET row_security=off");
    assert.equal((await read()).row_security_on, false);
    await db.exec("RESET row_security; SET session_replication_role=replica");
    assert.equal((await read()).origin_replication, false);
    await db.exec("RESET session_replication_role; SET search_path=public,pg_catalog");
    assert.equal((await read()).safe_search_path, false);
    await db.exec("RESET search_path; SET standard_conforming_strings=off");
    assert.equal((await read()).standard_strings, false);
  } finally { await db.close(); }
});
