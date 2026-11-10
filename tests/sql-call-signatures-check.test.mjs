import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkSqlCallSignatures as check } from "../scripts/check-sql-call-signatures.mjs";

function mismatches(call) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sql-calls-"));
  fs.mkdirSync(path.join(root, "prisma/migrations/1_a"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "prisma/migrations/1_a/migration.sql"), `CREATE FUNCTION public.grainline_old(p_a text) RETURNS void AS $$ $$ LANGUAGE sql;
    DROP FUNCTION public.grainline_old(text);
    CREATE OR REPLACE FUNCTION public.grainline_inbox(p_user text, p_limit integer DEFAULT 10, OUT id text) AS $$ $$ LANGUAGE sql;`);
  fs.writeFileSync(path.join(root, "src/x.ts"), `const run = (db, a) => db.$queryRaw\`${call}\`;`);
  return check(root).mismatches.length;
}

test("every SQL call in the current source matches its migrated signature", () => {
  const root = path.resolve(import.meta.dirname, "..");
  // CI moves some migrations aside during npm test and keeps a full copy in this directory.
  const { calls, mismatches: found } = check(root, process.env.DATABASE_FULL_CHAIN_TEST_MIGRATIONS_DIR ?? path.join(root, "prisma/migrations"));
  assert.ok(calls > 100, `found only ${calls} calls`);
  assert.deepEqual(found, []);
});

test("accepts a call with or without the optional argument", () => {
  assert.equal(mismatches("SELECT * FROM public.grainline_inbox(\\${a}::text)"), 0);
  assert.equal(mismatches("SELECT id FROM grainline_inbox(\\${a}::text, \\${a}::integer)"), 0);
});

test("rejects too many arguments, a wrong cast, and a dropped or unknown function", () => {
  assert.equal(mismatches("SELECT * FROM grainline_inbox(\\${a}, 1, 2)"), 1);
  assert.equal(mismatches("SELECT * FROM grainline_inbox(\\${a}::integer)"), 1);
  assert.equal(mismatches("SELECT * FROM grainline_old(\\${a}::text)"), 1);
  assert.equal(mismatches("SELECT * FROM grainline_missing()"), 1);
});

