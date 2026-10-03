import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/user-email-address-preparation-recovery-production.yml",
  "utf8",
);

const migrations = [
  [
    "3f2e6061e1de1a6f6c92645979a686ec4d3ee36409dc4499c2c62c90dafe1cf8",
    "20261002160000_add_user_email_suppression_key_index",
  ],
  [
    "a4b247ce83e871f657ee8228873c3113bdc5cf58adb7292a2e90206c147f67a8",
    "20261002161000_add_user_email_address_suppression_key_index",
  ],
  [
    "02ccc97c9e4d1e48320b58bd7ccc23aa023b7330d0add6fcf76802cc266f567c",
    "20261002162000_add_user_email_address_current_unique_index",
  ],
  [
    "4b058ca847eac24428f8bd4733ed81fed26c6aa138437740e18c58da80bb2933",
    "20261002170000_prepare_user_email_address_authority",
  ],
  [
    "b64751439f75fce70850ab43446c35ce6df45301b2a03970b560306898df1f2e",
    "20261003010000_repair_user_email_address_current_history",
  ],
];

test("recovery workflow parses and is manual, exact-main, CI, failure, and Production bound", () => {
  const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.jobs.recover.environment, "Production");
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(workflow, /inputs\.failed_migration_run_id == '37109191878'/u);
  assert.match(
    workflow,
    /failed\.head_sha !== '70c92a620a3c2d6443dc94794f8533d69662a0a6'/u,
  );
  assert.match(
    workflow,
    /failedSteps\[0\]\.name !== 'Apply only the reviewed UserEmailAddress preparation'/u,
  );
  assert.match(workflow, /ci\.head_sha !== releaseCommit/u);
});

test("recovery source hashes and the exact five-migration scope are pinned", () => {
  for (const [digest, migration] of migrations) {
    assert.match(
      workflow,
      new RegExp(
        `${digest}[\\s\\S]*${migration}|${migration}[\\s\\S]*${digest}`,
        "u",
      ),
    );
  }
  assert.match(
    workflow,
    /mv "prisma\/migrations\/\$migration" "\$holding\/\$migration"/u,
  );
  assert.match(
    workflow,
    /node scripts\/user-email-address-preparation-production-recovery\.mjs --inspect/u,
  );
});

test("recovery orders exact inspection, resolve, resolved proof, deploy, and postflight", () => {
  const inspect = workflow.indexOf("Inspect exact restart state read-only");
  const resolve = workflow.indexOf(
    "Mark only the exact failed zero-step row rolled back",
  );
  const resolved = workflow.indexOf("Prove exact resolved boundary read-only");
  const pending = workflow.indexOf("Prove no unrelated migration is pending");
  const deploy = workflow.indexOf(
    "Apply only the corrected UserEmailAddress preparation",
  );
  const prepared = workflow.indexOf("Prove exact prepared boundary read-only");
  assert.ok(inspect < resolve && resolve < resolved && resolved < pending);
  assert.ok(pending < deploy && deploy < prepared);
  assert.equal((workflow.match(/migrate resolve/gu) ?? []).length, 1);
  assert.equal(
    (workflow.match(/run: npx prisma migrate deploy/gu) ?? []).length,
    1,
  );
  assert.match(workflow, /if: steps\.inspect\.outputs\.state == 'failed'/u);
  assert.match(workflow, /if: steps\.inspect\.outputs\.state != 'prepared'/u);
  assert.match(workflow, /npm run audit:db-grants -- --require-direct-url/u);
});

test("inline binding and state-reader programs are syntactically valid", () => {
  const scripts = [
    ...workflow.matchAll(/script: \|\n([\s\S]*?)(?=\n\s{6}- name:)/gu),
  ].map((match) => match[1].replace(/^ {12}/gmu, ""));
  assert.equal(scripts.length, 1);
  const checked = spawnSync(
    process.execPath,
    ["--input-type=module", "--check"],
    {
      input: scripts[0],
      encoding: "utf8",
    },
  );
  assert.equal(checked.status, 0, checked.stderr);
});

test("recovery cannot deploy the app or activate RLS", () => {
  assert.doesNotMatch(workflow, /vercel\s+(?:deploy|alias|promote)/iu);
  assert.doesNotMatch(
    workflow,
    /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu,
  );
  assert.doesNotMatch(
    workflow,
    /stripe\s+(?:charges|transfers|refunds|events)/iu,
  );
});

test("each concurrent index migration contains exactly one statement", () => {
  for (const [, migration] of migrations.slice(0, 3)) {
    const sql = readFileSync(
      `prisma/migrations/${migration}/migration.sql`,
      "utf8",
    );
    assert.equal(
      (sql.match(/CREATE(?: UNIQUE)? INDEX CONCURRENTLY/gu) ?? []).length,
      1,
    );
    assert.equal((sql.match(/;\s*(?:--[^\n]*\n\s*)*$/gu) ?? []).length, 1);
    assert.doesNotMatch(sql, /^\s*DROP INDEX/imu);
  }
});
