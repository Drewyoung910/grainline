import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { deriveGrantInventory } from "../scripts/audit-runtime-db-grants.mjs";
import { USER_AUTHORITY_GROUPS } from "../scripts/user-authority-catalog.mjs";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const migrations = [
  "20261006010000_prepare_user_staff_ban_authorities",
  "20261006020000_prepare_user_account_deletion_authorities",
  "20261006030000_prepare_user_relationship_authorities",
];
const heldTests = [
  "user-staff-ban-authorities.test.mjs",
  "user-account-deletion-authorities.test.mjs",
  "user-relationship-authorities.test.mjs",
  "user-authority-catalog.test.mjs",
  "user-accumulated-access-ci.test.mjs",
  "order-ban-review-authority.test.mjs",
];

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, name);
  const next = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, next < 0 ? undefined : next);
}

function bashBody(name) {
  return step(name).split("        run: |\n")[1].split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
}

test("new User families are proved then isolated until historical prerequisites finish", () => {
  const verify = "Verify accumulated User access source package";
  const isolate = "Isolate accumulated User access until its predecessors pass";
  const restore = "Restore accumulated User access source package";
  const apply = "Apply accumulated User access in disposable PostgreSQL";
  const audit = "Audit runtime grants after accumulated User access";
  assert.ok(workflow.indexOf(verify) < workflow.indexOf(isolate));
  assert.ok(workflow.indexOf(isolate) < workflow.indexOf("Isolate User public-identity first package"));
  assert.ok(workflow.indexOf(restore) > workflow.indexOf("Audit runtime grants after User public seller-state snapshot"));
  assert.ok(workflow.indexOf(restore) < workflow.indexOf(apply));
  assert.ok(workflow.indexOf(apply) < workflow.indexOf(audit));
  assert.ok(workflow.indexOf(audit) < workflow.indexOf("Production build"));
  for (const migration of migrations) {
    for (const name of [isolate, restore, apply]) assert.ok(step(name).includes(migration), `${name}: ${migration}`);
  }
  for (const file of heldTests) {
    assert.ok(step(verify).includes(file), file);
    assert.ok(step(isolate).includes(file), file);
  }
  assert.match(step(apply), /psql "\$DIRECT_URL" --set=ON_ERROR_STOP=on/);
  assert.match(step(apply), /--file="prisma\/migrations\/\$migration\/migration\.sql"/);
  assert.doesNotMatch(step(apply), /gh |vercel|workflow_dispatch|environment: Production/);
});

test("actual isolation and restoration scripts preserve all source bytes in a disposable filesystem", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "grainline-user-ci-staging-"));
  const root = path.join(temporary, "checkout");
  const holding = path.join(temporary, "runner");
  try {
    mkdirSync(root);
    mkdirSync(holding);
    mkdirSync(path.join(root, "tests"));
    cpSync("prisma", path.join(root, "prisma"), { recursive: true });
    for (const file of heldTests) cpSync(`tests/${file}`, path.join(root, "tests", file));
    const trackedPaths = [...migrations.map((migration) => `prisma/migrations/${migration}/migration.sql`), ...heldTests.map((file) => `tests/${file}`)];
    const hash = (relative) => createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex");
    const original = trackedPaths.map(hash);
    execFileSync("bash", ["-c", bashBody("Isolate accumulated User access until its predecessors pass")], { cwd: root, env: { PATH: process.env.PATH, RUNNER_TEMP: holding } });
    assert.ok(trackedPaths.every((relative) => !existsSync(path.join(root, relative))));
    const heldFunctions = USER_AUTHORITY_GROUPS.filter(({ migration }) => migrations.includes(migration)).flatMap(({ functions }) => functions.map(({ name }) => name));
    const historical = deriveGrantInventory(root);
    assert.ok(heldFunctions.every((name) => !historical.functions.includes(name)));
    execFileSync("bash", ["-c", bashBody("Restore accumulated User access source package")], { cwd: root, env: { PATH: process.env.PATH, RUNNER_TEMP: holding } });
    assert.deepEqual(trackedPaths.map(hash), original);
    const restored = deriveGrantInventory(root);
    assert.ok(heldFunctions.every((name) => restored.functions.includes(name)));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
