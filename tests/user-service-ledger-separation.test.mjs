import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function prismaModel(schema, name) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `missing Prisma model ${name}`);
  return match[1];
}

test("User-adjacent service ledgers remain scalar and separately classified", () => {
  const schema = source("prisma/schema.prisma");
  const matrix = source("docs/rls-coverage-matrix.md");
  const clerk = prismaModel(schema, "ClerkWebhookEvent");
  const deletion = prismaModel(schema, "AccountDeletionSideEffect");

  assert.doesNotMatch(clerk, /\bUser\??\b|@relation\b/);
  assert.doesNotMatch(deletion, /\bUser\??\b|@relation\b/);
  assert.match(deletion, /\buserId\s+String\s+@db\.VarChar\(191\)/);
  assert.match(matrix, /\| `ClerkWebhookEvent` \| `ALTERNATIVE_REVIEW` \|/);
  assert.match(matrix, /\| `AccountDeletionSideEffect` \| `ALTERNATIVE_REVIEW` \|/);
});

test("the separation decision preserves predecessor grants and tracks both closures", () => {
  const decision = source("docs/user-service-ledger-separation-decision.md");
  const grants = source("scripts/provision-runtime-db-role.sql");
  const backlog = source("docs/deferred-launch-backlog.md");

  assert.match(decision, /separate from the `User` table activation group/);
  assert.match(decision, /changes no table or column grant, policy, RLS posture, role,[\s\S]*for either ledger/);
  assert.match(decision, /does not claim PostgreSQL-level provider authentication/);
  assert.match(decision, /compromised ordinary-runtime\s+credential/);

  const broadCrud = grants.match(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE([\s\S]*?);/);
  assert.ok(broadCrud, "missing predecessor runtime CRUD block");
  assert.match(broadCrud[1], /public\."ClerkWebhookEvent"/);
  assert.match(broadCrud[1], /public\."AccountDeletionSideEffect"/);
  assert.match(backlog, /\| Clerk webhook event service ledger \| Conditional blocker \|/);
  assert.match(backlog, /\| Account-deletion side-effect service ledger \| Conditional blocker \|/);
});
