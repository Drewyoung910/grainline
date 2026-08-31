import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const WORKFLOW_PATH = ".github/workflows/production-migrations.yml";
const PHASE_A_GATE =
  "if: steps.order_payment_event_force_scope.outputs.state == 'phase-a-accepted'";

function stepBlock(workflow, name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const next = workflow.indexOf("\n      - ", start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

test("OrderPaymentEvent FORCE production workflow emits only exact restart states", () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const scope = stepBlock(
    workflow,
    "Inspect exact OrderPaymentEvent FORCE restart scope read-only",
  );

  assert.match(scope, /^\s+id: order_payment_event_force_scope$/mu);
  assert.match(
    scope,
    /npm run --silent audit:order-payment-event-force-production-scope/u,
  );
  assert.match(
    scope,
    /new Set\(\["phase-a-accepted", "force-hardened"\]\)/u,
  );
  assert.match(scope, /state=\$\{value\.state\}/u);
  assert.match(scope, />> "\$GITHUB_OUTPUT"/u);
  assert.doesNotMatch(workflow, /continue-on-error/u);
});

test("every predecessor replay step is Phase-A-only", () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const firstReplay = workflow.indexOf(
    "      - name: Isolate unapplied OrderPaymentEvent FORCE release\n",
  );
  const finalVerification = workflow.indexOf(
    "      - name: Verify restored exact OrderPaymentEvent FORCE migration tree\n",
  );
  assert.ok(firstReplay >= 0 && finalVerification > firstReplay);

  const replay = workflow.slice(firstReplay, finalVerification);
  const names = [...replay.matchAll(/^      - name: (.+)$/gmu)].map(
    (match) => match[1],
  );
  assert.equal(names.length, 68, "expected the complete sealed predecessor replay");
  for (const name of names) {
    assert.match(
      stepBlock(workflow, name),
      new RegExp(PHASE_A_GATE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      `${name} must be skipped when production is already FORCE-hardened`,
    );
  }
});

test("FORCE production re-proves current Phase A instead of obsolete pre-activation posture", () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const scope = stepBlock(
    workflow,
    "Re-prove exact OrderPaymentEvent Phase-A predecessor scope",
  );
  assert.match(
    scope,
    new RegExp(PHASE_A_GATE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
  assert.match(
    scope,
    /audit:order-payment-event-force-production-scope/u,
  );
  assert.match(scope, /ORDER_PAYMENT_EVENT_FORCE_SCOPE_STAGE: restart/u);
  assert.match(scope, /value\.state !== "phase-a-accepted"/u);
  assert.match(
    scope,
    /force_path="prisma\/migrations\/20260831010000_force_order_payment_event_rls"/u,
  );
  assert.match(
    scope,
    /staged_force_path="\$RUNNER_TEMP\/order-payment-event-force-release"/u,
  );
  const trap = scope.indexOf("trap restore_isolated_force EXIT");
  const restoreTree = scope.indexOf('mv "$staged_force_path" "$force_path"');
  const proof = scope.indexOf("audit:order-payment-event-force-production-scope");
  const reIsolateTree = scope.lastIndexOf("\n          restore_isolated_force\n");
  const disarmTrap = scope.indexOf("trap - EXIT");
  assert.ok(trap >= 0 && trap < restoreTree);
  assert.ok(restoreTree < proof && proof < reIsolateTree);
  assert.ok(reIsolateTree < disarmTrap);
  assert.match(
    scope,
    /if \[\[ ! -d "\$staged_force_path" \|\| -e "\$force_path" \]\][\s\S]*exit 1/u,
  );
  assert.doesNotMatch(
    workflow,
    /Prove exact OrderPaymentEvent transition-authority predecessor scope/u,
  );
  assert.doesNotMatch(
    workflow,
    /ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_SCOPE_STAGE: after/u,
  );
});

test("migration deployment is Phase-A-only while final convergence is restart-safe", () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const apply = stepBlock(workflow, "Apply production migrations");
  assert.match(
    apply,
    new RegExp(PHASE_A_GATE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
  assert.match(apply, /npx prisma migrate deploy/u);

  const alwaysRun = [
    "Verify restored exact OrderPaymentEvent FORCE migration tree",
    "Verify restored exact OrderPaymentEvent FORCE release",
    "Re-inspect exact OrderPaymentEvent FORCE restart scope read-only",
    "Generate Prisma client",
    "Converge exact FORCE-hardened OrderPaymentEvent runtime grants",
    "Verify production migration status",
    "Audit final runtime grants and RLS catalog",
    "Prove exact OrderPaymentEvent FORCE production scope",
  ];
  for (const name of alwaysRun) {
    assert.doesNotMatch(
      stepBlock(workflow, name),
      /steps\.order_payment_event_force_scope\.outputs\.state/u,
      `${name} must run in both accepted restart states`,
    );
  }

  const order = [
    "Verify exact OrderPaymentEvent FORCE migration tree",
    "Verify exact OrderPaymentEvent FORCE release",
    "Inspect exact OrderPaymentEvent FORCE restart scope read-only",
    "Verify restored exact OrderPaymentEvent FORCE migration tree",
    "Re-inspect exact OrderPaymentEvent FORCE restart scope read-only",
    "Apply production migrations",
    "Converge exact FORCE-hardened OrderPaymentEvent runtime grants",
    "Verify production migration status",
    "Audit final runtime grants and RLS catalog",
    "Prove exact OrderPaymentEvent FORCE production scope",
  ].map((name) => workflow.indexOf(`      - name: ${name}\n`));
  assert.ok(order.every((position) => position >= 0));
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
});

test("FORCE release has one fail-closed proof cycle before its final restore", () => {
  const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const migrationPath =
    "prisma/migrations/20260831010000_force_order_payment_event_rls";
  const stagedPath = '"$RUNNER_TEMP/order-payment-event-force-release"';
  const initialIsolation = stepBlock(
    workflow,
    "Isolate unapplied OrderPaymentEvent FORCE release",
  );
  const proofCycle = stepBlock(
    workflow,
    "Re-prove exact OrderPaymentEvent Phase-A predecessor scope",
  );
  const finalRestore = stepBlock(
    workflow,
    "Restore the complete reviewed OrderPaymentEvent release chain",
  );
  assert.ok(initialIsolation.indexOf(migrationPath) >= 0);
  assert.ok(initialIsolation.indexOf(migrationPath) < initialIsolation.indexOf(stagedPath));
  assert.match(proofCycle, /trap restore_isolated_force EXIT/u);
  assert.match(proofCycle, /mv "\$staged_force_path" "\$force_path"/u);
  assert.match(proofCycle, /mv "\$force_path" "\$staged_force_path"/u);
  assert.ok(finalRestore.indexOf(stagedPath) >= 0);
  assert.ok(finalRestore.indexOf(stagedPath) < finalRestore.indexOf(migrationPath));
  assert.equal(workflow.split(migrationPath).length - 1, 3);
  assert.equal(workflow.split(stagedPath).length - 1, 3);
});
