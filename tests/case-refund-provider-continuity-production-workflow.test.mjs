import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import yaml from "js-yaml";

const workflow = readFileSync(
  ".github/workflows/case-refund-provider-continuity-production.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const conversationProof = readFileSync(
  ".github/workflows/conversation-message-force-proof.yml",
  "utf8",
);
const notificationProof = readFileSync(
  ".github/workflows/notification-rls-ephemeral-proof.yml",
  "utf8",
);

test("Case refund continuity Production workflow parses and its inline programs compile", () => {
  const parsed = yaml.load(workflow, { schema: yaml.JSON_SCHEMA });
  assert.ok(parsed.on.workflow_dispatch);
  assert.equal(parsed.permissions.actions, "read");
  assert.equal(parsed.permissions.contents, "read");
  assert.equal(parsed.concurrency.group, "production-database-migrations");
  assert.equal(parsed.jobs.apply.environment, "Production");

  const scripts = [
    ...workflow.matchAll(
      /node --input-type=module - <<'NODE'\n([\s\S]*?)\n\s+NODE/gu,
    ),
  ].map((match) => match[1].replace(/^ {10}/gmu, ""));
  assert.equal(scripts.length, 2);
  for (const script of scripts) {
    const checked = spawnSync(
      process.execPath,
      ["--input-type=module", "--check"],
      { input: script, encoding: "utf8" },
    );
    assert.equal(checked.status, 0, checked.stderr);
  }
});

test("Production admission is exact-main, exact-CI, first-attempt and typed", () => {
  assert.match(
    workflow,
    /inputs\.confirmation == 'apply-reviewed-case-refund-provider-continuity'/u,
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(workflow, /github\.run_attempt == 1/u);
  assert.match(
    workflow,
    /main\.commit\.sha !== sha[\s\S]*run\.event !== 'push'[\s\S]*run\.head_branch !== 'main'[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/u,
  );
  assert.match(
    workflow,
    /PRODUCTION_MIGRATION_RELEASE_COMMIT: \$\{\{ inputs\.release_commit \}\}/u,
  );
});

test("workflow admits only the exact continuity successor after its exact predecessor", () => {
  assert.match(
    workflow,
    /dad13cbbaf2de845c591c0f8000a21d5d19ba7c19ccf61c9179ca92b4524a8ce\s+prisma\/migrations\/20261002020000_correct_case_refund_provider_recovery_continuity\/migration\.sql/u,
  );
  assert.match(
    workflow,
    /48703a338824b827b96231cce7e45f305ed0b106244743fdceb399a80ffecfbe/u,
  );
  assert.match(
    workflow,
    /tail -n 1[\s\S]*20261002020000_correct_case_refund_provider_recovery_continuity/u,
  );
  assert.match(
    workflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed Case refund provider-continuity migration/u,
  );
});

test("workflow preserves exact function ACLs and policyless FORCE posture", () => {
  for (const hash of [
    "a010dd797a770fdbb1c821f3e09c3717c5b517de315723e33d34f1c493f2bf7f",
    "19b554741fce36f911cbba1dc771af88756ef02213ec9424e3ed4c8311a1ddca",
    "f2ff2bb23e2e0be1d35e6f4a0e91ae0575df10e7f7bcc844d50c1572a503f09d",
  ]) {
    assert.match(workflow, new RegExp(hash, "u"));
  }
  assert.match(workflow, /assert\.equal\(row\.prosrc, sourceFor\(expected\[0\]\)\)/u);
  assert.match(workflow, /assert\.equal\(row\.runtime_execute, expected\[1\]\)/u);
  assert.match(workflow, /assert\.equal\(row\.public_execute, false\)/u);
  assert.match(workflow, /assert\.deepEqual\(\(await client\.query\(postureSql\)\)\.rows, before\)/u);
  assert.match(workflow, /npm run audit:db-grants/u);
});

test("CI restores continuity only after partial-refund fulfillment", () => {
  const verify = ci.indexOf("Verify Case refund provider-continuity source package");
  const isolate = ci.indexOf("Isolate Case refund provider continuity until every predecessor passes");
  const partialApply = ci.indexOf("Apply partial-refund fulfillment successor in disposable PostgreSQL");
  const restore = ci.indexOf("Restore Case refund provider continuity successor");
  const apply = ci.indexOf("Apply Case refund provider continuity successor in disposable PostgreSQL");
  const build = ci.indexOf("Production build");
  assert.ok(verify >= 0);
  assert.ok(isolate > verify);
  assert.ok(partialApply > isolate);
  assert.ok(restore > partialApply);
  assert.ok(apply > restore);
  assert.ok(build > apply);
  assert.match(
    ci,
    /Restore Case refund provider continuity successor[\s\S]*Re-verify Case refund provider-continuity source package[\s\S]*Apply Case refund provider continuity successor in disposable PostgreSQL[\s\S]*Audit runtime grants after Case refund provider continuity successor/u,
  );
});

test("historical FORCE proofs isolate and restore both recent successors", () => {
  for (const proof of [conversationProof, notificationProof]) {
    assert.match(
      proof,
      /48703a338824b827b96231cce7e45f305ed0b106244743fdceb399a80ffecfbe 20261002010000_allow_partial_refund_fulfillment/u,
    );
    assert.match(
      proof,
      /dad13cbbaf2de845c591c0f8000a21d5d19ba7c19ccf61c9179ca92b4524a8ce 20261002020000_correct_case_refund_provider_recovery_continuity/u,
    );
    assert.match(
      proof,
      /20261002010000_allow_partial_refund_fulfillment \\\n+\s+20261002020000_correct_case_refund_provider_recovery_continuity/u,
    );
  }
});

test("Production workflow cannot deploy the app or call payment and shipping providers", () => {
  assert.doesNotMatch(workflow, /\bvercel\b|alias set|deploy --prod/iu);
  assert.doesNotMatch(workflow, /api\.stripe\.com|api\.goshippo\.com/iu);
  assert.doesNotMatch(workflow, /stripe (?:refunds|transfers)|shippo/iu);
});
