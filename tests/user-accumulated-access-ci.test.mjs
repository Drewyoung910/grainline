import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { deriveGrantInventory } from "../scripts/audit-runtime-db-grants.mjs";
import { USER_AUTHORITY_GROUPS } from "../scripts/user-authority-catalog.mjs";

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const migrations = [
  "20261006010000_prepare_user_staff_ban_authorities",
  "20261006020000_prepare_user_account_deletion_authorities",
  "20261006030000_prepare_user_relationship_authorities",
  "20261007160000_converge_user_cross_domain_authorities",
];
const enableMigration = "20261008010000_enable_user_rls";
const heldMigrations = [...migrations, enableMigration];
const heldTests = [
  "user-staff-ban-authorities.test.mjs",
  "user-account-deletion-authorities.test.mjs",
  "user-relationship-authorities.test.mjs",
  "user-cross-domain-authority-convergence.test.mjs",
  "user-cross-domain-convergence-production-workflow.test.mjs",
  "user-rls-enable-postgres-proof.test.mjs",
  "user-rls-enable-production-inspect.test.mjs",
  "user-rls-enable-production-workflow.test.mjs",
  "user-rls-enable-release.test.mjs",
  "user-authority-catalog.test.mjs",
  "user-accumulated-access-ci.test.mjs",
  "order-ban-review-authority.test.mjs",
  "order-staff-read-role-provision.test.mjs",
  "order-staff-read-role-catalog-postgres.test.mjs",
  "account-deletion-blocker-refund-state.test.mjs",
  "account-deletion-timeout-fix.test.mjs",
  "round9-account-deletion-pii-guardrails.test.mjs",
  "conversation-message-pre-rls-audit.test.mjs",
];
const staffScript = "scripts/provision-order-staff-read-role.sql";
const historicalBase = "66746f47e87a73a6efce2ee6833542be5a86cc57";
const historicalStaffBlob = "46fd8e1bfa086cb097adf194eb193389122ee9d9";
const historicalStaffCatalogBlob = "6d0a46c02fa040e7651b675696cec67ad1b2fdd3";

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, name);
  const next = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, next < 0 ? undefined : next);
}

function bashBody(name) {
  return step(name).split("        run: |\n")[1].split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
}

test("every test with a literal held-migration dependency is admitted before replay isolation", () => {
  const omitted = [];
  for (const file of readdirSync("tests").filter((name) => name.endsWith(".test.mjs"))) {
    const parsed = ts.createSourceFile(file, readFileSync(path.join("tests", file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function visit(node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        && migrations.some((migration) => node.text.startsWith("prisma/migrations/" + migration + "/"))
        && !heldTests.includes(file)) omitted.push(file);
      ts.forEachChild(node, visit);
    }
    visit(parsed);
  }
  assert.deepEqual([...new Set(omitted)], []);
});

test("new User families are proved then isolated until historical prerequisites finish", () => {
  const verify = "Verify accumulated User access source package";
  const isolate = "Isolate accumulated User access until its predecessors pass";
  const restore = "Restore accumulated User access source package";
  const restoreEnable = "Restore User policyless ENABLE source package";
  const apply = "Apply accumulated User access in disposable PostgreSQL";
  const audit = "Audit runtime grants after accumulated User access";
  const converge = "Converge accumulated User and Order isolated staff grants";
  assert.ok(workflow.indexOf(verify) < workflow.indexOf(isolate));
  assert.ok(workflow.indexOf(isolate) < workflow.indexOf("Isolate User public-identity first package"));
  assert.ok(workflow.indexOf(restore) > workflow.indexOf("Audit runtime grants after User public seller-state snapshot"));
  assert.ok(workflow.indexOf(restore) < workflow.indexOf(apply));
  assert.ok(workflow.indexOf(apply) < workflow.indexOf(audit));
  assert.ok(workflow.indexOf(apply) < workflow.indexOf(converge));
  assert.ok(workflow.indexOf(converge) < workflow.indexOf(audit));
  assert.ok(workflow.indexOf(audit) < workflow.indexOf("Production build"));
  for (const migration of migrations) {
    for (const name of [isolate, restore, apply]) assert.ok(step(name).includes(migration), `${name}: ${migration}`);
  }
  assert.ok(step(isolate).includes(enableMigration));
  assert.ok(step(restoreEnable).includes(enableMigration));
  assert.ok(workflow.indexOf(restoreEnable) > workflow.indexOf(restore));
  assert.ok(workflow.indexOf(restoreEnable) < workflow.indexOf("Re-verify User policyless ENABLE source package"));
  for (const file of heldTests) {
    assert.ok(step(verify).includes(file), file);
    assert.ok(step(isolate).includes(file), file);
  }
  assert.match(step(apply), /psql "\$DIRECT_URL" --set=ON_ERROR_STOP=on/);
  assert.match(step(apply), /--file="prisma\/migrations\/\$migration\/migration\.sql"/);
  assert.doesNotMatch(step(apply), /gh |vercel|workflow_dispatch|environment: Production/);
  assert.ok(step(isolate).includes(historicalBase));
  assert.ok(step(isolate).includes(historicalStaffBlob));
  assert.ok(step(isolate).includes(staffScript));
  assert.ok(step(restore).includes(staffScript));
  assert.match(step(converge), /--set=staff_role=grainline_staff_read_runtime/);
  assert.match(step(converge), /--set=migration_role=ci/);
  assert.match(step(converge), /--file=scripts\/provision-order-staff-read-role\.sql/);
});

test("actual isolation and restoration scripts preserve source bytes while staging the follower catalog", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "grainline-user-ci-staging-"));
  const root = path.join(temporary, "checkout");
  const holding = path.join(temporary, "runner");
  try {
    execFileSync("git", ["clone", "--quiet", "--shared", "--no-checkout", process.cwd(), root], { env: { PATH: process.env.PATH } });
    mkdirSync(holding);
    mkdirSync(path.join(root, "tests"));
    mkdirSync(path.join(root, "scripts"));
    cpSync(staffScript, path.join(root, staffScript));
    cpSync("prisma", path.join(root, "prisma"), { recursive: true });
    for (const file of heldTests) cpSync(`tests/${file}`, path.join(root, "tests", file));
    const heldPaths = [...heldMigrations.map((migration) => `prisma/migrations/${migration}/migration.sql`), ...heldTests.map((file) => `tests/${file}`)];
    const trackedPaths = [...heldPaths, staffScript];
    const hash = (relative) => createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex");
    const original = trackedPaths.map(hash);
    const catalogPath = "tests/user-authority-catalog.test.mjs";
    const catalogIndex = trackedPaths.indexOf(catalogPath);
    execFileSync("bash", ["-c", bashBody("Isolate accumulated User access until its predecessors pass")], { cwd: root, env: { PATH: process.env.PATH, RUNNER_TEMP: holding } });
    assert.ok(heldPaths.every((relative) => !existsSync(path.join(root, relative))));
    const historicalStaff = readFileSync(path.join(root, staffScript), "utf8");
    assert.doesNotMatch(historicalStaff, /grainline_user_staff_/);
    assert.equal(execFileSync("git", ["hash-object", staffScript], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" }).trim(), historicalStaffBlob);
    const heldFunctions = USER_AUTHORITY_GROUPS.filter(({ migration }) => migrations.includes(migration)).flatMap(({ functions }) => functions.map(({ name }) => name));
    const historical = deriveGrantInventory(root);
    assert.ok(heldFunctions.every((name) => !historical.functions.includes(name)));
    mkdirSync(path.join(holding, "user-staff-admin-labels"));
    mkdirSync(path.join(holding, "user-follower-authority"));
    execFileSync("bash", ["-c", bashBody("Restore accumulated User access source package")], { cwd: root, env: { PATH: process.env.PATH, RUNNER_TEMP: holding } });
    assert.equal(existsSync(path.join(root, `prisma/migrations/${enableMigration}`)), false);
    execFileSync("bash", ["-c", bashBody("Restore User policyless ENABLE source package")], { cwd: root, env: { PATH: process.env.PATH, RUNNER_TEMP: holding } });
    for (const [index, relative] of trackedPaths.entries()) {
      if (relative !== catalogPath) assert.equal(hash(relative), original[index], relative);
    }
    assert.equal(
      execFileSync("git", ["hash-object", catalogPath], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" }).trim(),
      "ac17d95ad53501515550b2bb967eb5a149f094d9",
    );
    assert.equal(
      createHash("sha256").update(readFileSync(path.join(holding, "user-staff-admin-labels", "user-authority-catalog-test"))).digest("hex"),
      original[catalogIndex],
    );
    assert.equal(
      execFileSync("git", ["hash-object", path.join(holding, "user-follower-authority", "user-authority-catalog-test")], { cwd: root, env: { PATH: process.env.PATH }, encoding: "utf8" }).trim(),
      historicalStaffCatalogBlob,
    );
    assert.match(readFileSync(path.join(root, staffScript), "utf8"), /grainline_user_staff_directory_page/);
    const restored = deriveGrantInventory(root);
    assert.ok(heldFunctions.every((name) => restored.functions.includes(name)));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
