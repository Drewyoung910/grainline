import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { assertZeroDirectSchema, expectedZeroDirectSchema, readZeroDirectSchema } from "../scripts/order-zero-direct-release-schema.mjs";
import { createOrderZeroDirectReleaseScope } from "../scripts/order-zero-direct-release-scope.mjs";
import { createZeroDirectSchemaBase, applyZeroDirectSchemaMember } from "./helpers/order-zero-direct-schema-fixture.mjs";

test("schema inventory separates all four DDL transitions and rejects missing or premature state", () => {
  createOrderZeroDirectReleaseScope(); // attest exact DDL sources before any fixture derivation
  assert.equal(expectedZeroDirectSchema(17).length, 38);
  for (let n = 0; n <= 17; n += 1) {
    const records = expectedZeroDirectSchema(n);
    assertZeroDirectSchema(records, n);
    assert.throws(() => assertZeroDirectSchema(undefined, n));
    for (let i = 0; i < records.length; i += 1) {
      assert.throws(() => assertZeroDirectSchema(records.filter((_, j) => j !== i), n));
      assert.throws(() => assertZeroDirectSchema([...records, records[i]], n));
      for (const [key, value] of Object.entries(records[i])) {
        const drift = structuredClone(records);
        drift[i][key] = typeof value === "boolean" ? !value : typeof value === "number" ? value + 1 : "drift";
        assert.throws(() => assertZeroDirectSchema(drift, n), `${n}/${i}/${key}`);
      }
    }
    for (const other of [0, 3, 10, 11, 12]) {
      const alternative = expectedZeroDirectSchema(other);
      if (JSON.stringify(alternative) !== JSON.stringify(records))
        assert.throws(() => assertZeroDirectSchema(alternative, n));
    }
  }
  for (const value of [-1, 18, 1.5, null, "17"]) assert.throws(() => expectedZeroDirectSchema(value));
});

test("native drift proof is disposable-only, rollback bounded and never production-wired", () => {
  const source = readFileSync("scripts/order-zero-direct-release-structure-postgres-proof.mjs", "utf8");
  assert.match(source, /parseZeroDirectScopeProofConfig\(env\)/u);
  assert.match(source, /verifyInputRuntimeIdentity\(client, "grainline_ci", "ci"/u);
  assert.match(source, /finally \{ await client.query\("ROLLBACK"\); \}/u);
  assert.doesNotMatch(source, /query\("COMMIT"\)|INSERT INTO|DELETE FROM|UPDATE public|ALTER ROLE.*PASSWORD/u);
  assert.ok(source.indexOf("await verifyRepairProofRole") < source.indexOf('await client.query("BEGIN")'));
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(ci.indexOf("node scripts/order-zero-direct-release-structure-postgres-proof.mjs")
    > ci.indexOf("node scripts/order-zero-direct-release-scope-postgres-proof.mjs"));
  for (const path of [".github/workflows/production-migrations.yml", ".github/workflows/order-compatible-production.yml"])
    assert.doesNotMatch(readFileSync(path, "utf8"), /order-zero-direct-release-(?:structure|roles|schema)/u);
});

test("exact source DDL independently reproduces the committed catalog at every prefix state", async () => {
  createOrderZeroDirectReleaseScope();
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE ci SUPERUSER; CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS; SET SESSION AUTHORIZATION ci");
    await createZeroDirectSchemaBase(db);
    for (let n = 0; n <= 17; n += 1) {
      await applyZeroDirectSchemaMember(db, n);
      assertZeroDirectSchema(await readZeroDirectSchema(db, "ci"), n);
    }
    for (const [change, undo] of [
      ['ALTER TABLE public."OrderStaffCapability" ADD COLUMN unexpected text', 'ALTER TABLE public."OrderStaffCapability" DROP COLUMN unexpected'],
      ['ALTER TABLE public."OrderStaffCapability" ALTER COLUMN "createdAt" DROP DEFAULT', 'ALTER TABLE public."OrderStaffCapability" ALTER COLUMN "createdAt" SET DEFAULT pg_catalog.clock_timestamp()'],
      ['ALTER TABLE public."Order" ALTER COLUMN "sellerDeauthorizedAt" TYPE timestamp(6) without time zone', 'ALTER TABLE public."Order" ALTER COLUMN "sellerDeauthorizedAt" TYPE timestamp(3) without time zone'],
      ['ALTER TABLE public."SellerDeauthorizationApplication" DISABLE TRIGGER "SellerDeauthorizationApplication_immutable"', 'ALTER TABLE public."SellerDeauthorizationApplication" ENABLE TRIGGER "SellerDeauthorizationApplication_immutable"'],
      ['ALTER TABLE public."OrderStaffCapability" ADD CONSTRAINT unexpected CHECK(true)', 'ALTER TABLE public."OrderStaffCapability" DROP CONSTRAINT unexpected'],
      ['CREATE INDEX unexpected ON public."OrderStaffCapability" ("actorUserId")', 'DROP INDEX public.unexpected'],
    ]) {
      await db.exec(change);
      const rows = await readZeroDirectSchema(db, "ci");
      assert.throws(() => assertZeroDirectSchema(rows, 17));
      await db.exec(undo);
      assertZeroDirectSchema(await readZeroDirectSchema(db, "ci"), 17);
    }
    for (const row of expectedZeroDirectSchema(17).filter(r => r.kind === "constraint" && r.type === "c")) {
      const table = `public."${row.table_name}"`; const name = `"${row.name}"`;
      await db.exec("BEGIN");
      await db.exec(`ALTER TABLE ${table} DROP CONSTRAINT ${name}; ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK(true)`);
      const drift = await readZeroDirectSchema(db, "ci");
      assert.throws(() => assertZeroDirectSchema(drift, 17));
      await db.exec("ROLLBACK; BEGIN");
      await db.exec(`ALTER TABLE ${table} DROP CONSTRAINT ${name}; ALTER TABLE ${table} ADD CONSTRAINT ${name} ${row.definition} NOT VALID`);
      const unvalidated = await readZeroDirectSchema(db, "ci");
      assert.equal(unvalidated.find(r => r.kind === "constraint" && r.name === row.name).validated, false);
      assert.throws(() => assertZeroDirectSchema(unvalidated, 17));
      // Restore original DDL by rollback. Re-parsing pg_get_constraintdef can
      // produce a different expression tree even when SQL meaning is unchanged.
      await db.exec("ROLLBACK");
      assertZeroDirectSchema(await readZeroDirectSchema(db, "ci"), 17);
    }
  } finally { await db.close(); }
});
