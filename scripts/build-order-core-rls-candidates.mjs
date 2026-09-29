#!/usr/bin/env node
// Review-only: returns pinned SQL bytes without writing to Prisma migrations.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DRAFT_HEADER = "-- DRAFT ONLY. Do not apply to any persistent database.";
const RELEASE_HEADER = "-- Apply only through the guarded main-only production migration workflow.";

export const ORDER_CORE_DRAFTS = Object.freeze({
  enable: Object.freeze({
    path: "docs/rls-drafts/order-core-activation.sql",
    sha256: "f38bb44963daaa08309cf10a39c11f8146664cc77329e7d01fc73075778b5553",
    migrationHeader: `-- Reviewed policyless Core Order ENABLE and direct-grant revocation.\n${RELEASE_HEADER}`,
    migrationSha256: "350567d0141601fd858dcc2df99f59b085d1f66573560b027148e66278a1eec8",
  }),
  force: Object.freeze({
    path: "docs/rls-drafts/order-core-force.sql",
    sha256: "80e09ed20fedfa466babc5b2118134f65a8b241da61af64bc4db1a579a244a5b",
    migrationHeader: `-- Reviewed posture-only Core Order FORCE hardening.\n${RELEASE_HEADER}`,
    migrationSha256: "9a5491f25e8f8f92dae5299f0c8a722972d5d24b5696a636971415940c96da95",
  }),
  enableRollback: Object.freeze({
    path: "docs/rls-drafts/order-core-activation-rollback.sql",
    sha256: "39019f66139b1fb6f22cc4a48a09ec4bd27f5accded485989207bff196288ea9",
  }),
  forceRollback: Object.freeze({
    path: "docs/rls-drafts/order-core-force-rollback.sql",
    sha256: "d5da06aebf753c86622c3e5f633b667c8fbc47ee4801adffb998a48497a78206",
  }),
});

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const count = (value, pattern) => (value.match(pattern) ?? []).length;

function readDraft(rootDirectory, spec) {
  const source = fs.readFileSync(path.join(rootDirectory, spec.path), "utf8");
  if (sha256(source) !== spec.sha256 || !source.startsWith(`${DRAFT_HEADER}\n`)) {
    throw new Error(`Core Order draft bytes or header drifted: ${spec.path}`);
  }
  if (count(source, /^BEGIN;$/gmu) !== 1 || count(source, /^COMMIT;$/gmu) !== 1) {
    throw new Error(`Core Order draft transaction boundary drifted: ${spec.path}`);
  }
  return source;
}

function requireExactlyOne(source, pattern, label) {
  if (count(source, pattern) !== 1) throw new Error(`Core Order ${label} boundary drifted`);
}

export function buildOrderCoreRlsCandidates(rootDirectory = process.cwd()) {
  const enable = readDraft(rootDirectory, ORDER_CORE_DRAFTS.enable);
  const force = readDraft(rootDirectory, ORDER_CORE_DRAFTS.force);
  const enableRollback = readDraft(rootDirectory, ORDER_CORE_DRAFTS.enableRollback);
  const forceRollback = readDraft(rootDirectory, ORDER_CORE_DRAFTS.forceRollback);

  for (const source of [enable, force, enableRollback, forceRollback]) {
    if (/\b(?:CREATE|DROP)\s+POLICY\b|^ALTER TABLE public\."(?:OrderItem|OrderShippingRateQuote)"/imu.test(source)) {
      throw new Error("Core Order candidate crossed the single-table policyless boundary");
    }
  }
  requireExactlyOne(enable, /^ALTER TABLE public\."Order" ENABLE ROW LEVEL SECURITY;$/gmu, "ENABLE");
  requireExactlyOne(enable, /^REVOKE ALL ON TABLE public\."Order"\s+FROM PUBLIC, grainline_app_runtime;$/gmu, "ENABLE revocation");
  requireExactlyOne(force, /^ALTER TABLE public\."Order" FORCE ROW LEVEL SECURITY;$/gmu, "FORCE");
  requireExactlyOne(forceRollback, /^ALTER TABLE public\."Order" NO FORCE ROW LEVEL SECURITY;$/gmu, "FORCE rollback");
  requireExactlyOne(enableRollback, /^ALTER TABLE public\."Order" DISABLE ROW LEVEL SECURITY;$/gmu, "ENABLE rollback");
  requireExactlyOne(enableRollback, /^GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\."Order"\s+TO grainline_app_runtime;$/gmu, "predecessor grant recovery");

  const enableMigration = enable.replace(DRAFT_HEADER, ORDER_CORE_DRAFTS.enable.migrationHeader);
  const forceMigration = force.replace(DRAFT_HEADER, ORDER_CORE_DRAFTS.force.migrationHeader);
  if (sha256(enableMigration) !== ORDER_CORE_DRAFTS.enable.migrationSha256 ||
      sha256(forceMigration) !== ORDER_CORE_DRAFTS.force.migrationSha256) {
    throw new Error("Core Order promoted candidate byte pin drifted");
  }

  return Object.freeze({
    enableMigration,
    forceMigration,
    enableRollback,
    forceRollback,
    enableMigrationSha256: ORDER_CORE_DRAFTS.enable.migrationSha256,
    forceMigrationSha256: ORDER_CORE_DRAFTS.force.migrationSha256,
    enableRollbackSha256: ORDER_CORE_DRAFTS.enableRollback.sha256,
    forceRollbackSha256: ORDER_CORE_DRAFTS.forceRollback.sha256,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2 && (process.argv.length !== 3 || process.argv[2] !== "--verify")) {
    throw new Error("usage: build-order-core-rls-candidates.mjs [--verify]");
  }
  const candidate = buildOrderCoreRlsCandidates();
  process.stdout.write(`${JSON.stringify({
    mode: "review-only",
    migrationTreeWritten: false,
    enableMigrationSha256: candidate.enableMigrationSha256,
    forceMigrationSha256: candidate.forceMigrationSha256,
    enableRollbackSha256: candidate.enableRollbackSha256,
    forceRollbackSha256: candidate.forceRollbackSha256,
  })}\n`);
}
