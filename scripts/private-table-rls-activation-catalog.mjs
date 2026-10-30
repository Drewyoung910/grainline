#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  functionSourceFromMigration,
  privateTablePreparation,
  verifyPrivateTablePreparationSource,
} from "./private-table-preparation-catalog.mjs";

const RELEASE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;

export const PRIVATE_TABLE_RLS_ACTIVATION_CONFIRMATION =
  "activate-reviewed-private-table-rls";

const OWNER_USER_ID_QUAL =
  "(\"userId\" = NULLIF(current_setting('app.user_id'::text, true), ''::text))";
const OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT =
  "0c0e9e67081c2ad7b27d97bc3f5956ecd2090549";
const PREDECESSOR_CRUD = Object.freeze([
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
]);
const NO_PRIVILEGES = Object.freeze([]);
const NO_POLICIES = Object.freeze([]);
const NO_FUNCTION_CHANGES = Object.freeze({
  retained: Object.freeze([]),
  replacements: Object.freeze([]),
  additions: Object.freeze([]),
});

export const PRIVATE_TABLE_RLS_ACTIVATIONS = Object.freeze({
  favorite_v1: Object.freeze({
    preparationReleaseId: "favorite_v1",
    minimumCompatibleAppCommit: OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261028050000_activate_favorite_rls",
    migrationSha256:
      "e338d85fd1e2a124ce0a32cb755836f35c565ce4fabc374d0df4cdc07f9fb358",
    rollbackPath: "docs/rls-drafts/favorite-activation-rollback.sql",
    rollbackSha256:
      "58bb32267b836b8f920e9e9cfe4f786581ca5d14c5a08351b82a7b9b27f71e3d",
    table: "Favorite",
    mode: "owner_policy_combined_enable_force",
    policies: Object.freeze([
      Object.freeze({
        name: "favorite_owner_select",
        command: "r",
        permissive: true,
        roles: Object.freeze(["grainline_app_runtime"]),
        using: OWNER_USER_ID_QUAL,
        withCheck: null,
      }),
      Object.freeze({
        name: "favorite_owner_delete",
        command: "d",
        permissive: true,
        roles: Object.freeze(["grainline_app_runtime"]),
        using: OWNER_USER_ID_QUAL,
        withCheck: null,
      }),
    ]),
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: Object.freeze(["SELECT", "DELETE"]),
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze(["tests/favorite-rls-activation.test.mjs"]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: NO_FUNCTION_CHANGES,
  }),
  follow_v1: Object.freeze({
    preparationReleaseId: "follow_v1",
    minimumCompatibleAppCommit: OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261028060000_activate_follow_rls",
    migrationSha256:
      "a2b8de8d2e6ad171b4eee951b32cbecdcf40999fcad85b1f1a72e8bab71007e2",
    rollbackPath: "docs/rls-drafts/follow-activation-rollback.sql",
    rollbackSha256:
      "db9baa25124fc650e9d08e383933a5b13bdad7fdb30b77726d7499a66019bc0c",
    table: "Follow",
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze(["tests/follow-rls-activation.test.mjs"]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: Object.freeze({
      retained: Object.freeze([
        Object.freeze({
          name: "grainline_user_follower_notification_page",
          arguments: "text, text, integer",
          sourceMd5: "471b1caf9907d6d370ec1cb8ea5aa718",
          predecessorExecuteRole: "runtime",
          activatedExecuteRole: "none",
        }),
      ]),
      replacements: Object.freeze([]),
      additions: Object.freeze([]),
    }),
  }),
  review_vote_v1: Object.freeze({
    preparationReleaseId: "review_vote_v1",
    minimumCompatibleAppCommit: OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261028070000_activate_review_vote_rls",
    migrationSha256:
      "0d9a9081354a199f0ead4744ca2b8782a5e370c5fe95013c796ffde6ced6ff6a",
    rollbackPath: "docs/rls-drafts/review-vote-activation-rollback.sql",
    rollbackSha256:
      "3b8db98d85c6fb8309f13608d787775cc796a409afba99b60f51bc718c3cc6b3",
    table: "ReviewVote",
    mode: "owner_policy_combined_enable_force",
    policies: Object.freeze([
      Object.freeze({
        name: "review_vote_owner_select",
        command: "r",
        permissive: true,
        roles: Object.freeze(["grainline_app_runtime"]),
        using: OWNER_USER_ID_QUAL,
        withCheck: null,
      }),
    ]),
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: Object.freeze(["SELECT"]),
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze(["tests/review-vote-rls-activation.test.mjs"]),
    rollbackTriggerDrops: Object.freeze(["ReviewVote_count_after_delete"]),
    functionChanges: Object.freeze({
      retained: Object.freeze([]),
      replacements: Object.freeze([]),
      additions: Object.freeze([
        Object.freeze({
          name: "grainline_review_vote_count_after_delete",
          arguments: "",
          executeRole: "none",
        }),
      ]),
    }),
  }),
  maker_verification_v1: Object.freeze({
    preparationReleaseId: "maker_verification_v1",
    minimumCompatibleAppCommit: OWNER_SOCIAL_MINIMUM_COMPATIBLE_COMMIT,
    migration: "20261028080000_activate_maker_verification_rls",
    migrationSha256:
      "7868277f03b599768784c0f3a44a3c7bb28c8b64772a24f6183c538ec6f3401c",
    rollbackPath: "docs/rls-drafts/maker-verification-activation-rollback.sql",
    rollbackSha256:
      "b0deed025ab8d21daa57818f66f9324cfa5a71c353230a49d2d97003a4a867d0",
    table: "MakerVerification",
    mode: "policyless_combined_enable_force",
    policies: NO_POLICIES,
    predecessorRuntimePrivileges: PREDECESSOR_CRUD,
    activatedRuntimePrivileges: NO_PRIVILEGES,
    activatedStaffPrivileges: NO_PRIVILEGES,
    activatedPublicPrivileges: NO_PRIVILEGES,
    sourceTests: Object.freeze(["tests/maker-verification-preparation.test.mjs"]),
    rollbackTriggerDrops: Object.freeze([]),
    functionChanges: NO_FUNCTION_CHANGES,
  }),
});

export const PRIVATE_TABLE_RLS_ACTIVATION_BATCHES = Object.freeze({
  owner_social_verification_v1: Object.freeze([
    "favorite_v1",
    "follow_v1",
    "review_vote_v1",
    "maker_verification_v1",
  ]),
});

function stopped(message) {
  return new Error(`private-table RLS activation stopped: ${message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function artifact(rootDir, relativePath, expectedDigest, label) {
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(rootDir, relativePath);
  const bytes = readFileSync(absolutePath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedDigest) throw stopped(`${label} digest drifted`);
  return Object.freeze({
    path: absolutePath,
    digest,
    sql: bytes.toString("utf8"),
  });
}

function signatureLiteral(entry) {
  return `public.${entry.name}(${entry.arguments.replace(/,\s+/gu, ",")})`;
}

export function privateTableRlsActivation(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = PRIVATE_TABLE_RLS_ACTIVATIONS[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  const preparation = privateTablePreparation(release.preparationReleaseId);
  if (preparation.table !== release.table) {
    throw stopped("preparation table drifted");
  }
  return Object.freeze({ ...release, preparation });
}

export function privateTableRlsActivationReleaseIds(selectionId) {
  if (typeof selectionId !== "string" || !RELEASE_ID_PATTERN.test(selectionId)) {
    throw stopped("release id is invalid");
  }
  if (PRIVATE_TABLE_RLS_ACTIVATIONS[selectionId]) {
    return Object.freeze([selectionId]);
  }
  const batch = PRIVATE_TABLE_RLS_ACTIVATION_BATCHES[selectionId];
  if (!batch) throw stopped("release id is not reviewed");
  const releases = batch.map((releaseId) => privateTableRlsActivation(releaseId));
  const migrations = releases.map((release) => release.migration);
  if (new Set(batch).size !== batch.length || new Set(migrations).size !== migrations.length) {
    throw stopped("batch contains duplicate releases");
  }
  const sortedMigrations = [...migrations].sort((left, right) => left.localeCompare(right));
  if (migrations.join("|") !== sortedMigrations.join("|")) {
    throw stopped("batch migrations are not ordered");
  }
  const minimumCommits = new Set(
    releases.map((release) => release.minimumCompatibleAppCommit),
  );
  if (minimumCommits.size !== 1) {
    throw stopped("batch minimum compatible app commits differ");
  }
  return batch;
}

export function privateTableRlsActivationMigrationPath(release) {
  return `prisma/migrations/${release.migration}/migration.sql`;
}

export function verifyPrivateTableRlsActivationSource(
  releaseId,
  rootDir = process.cwd(),
) {
  const release = privateTableRlsActivation(releaseId);
  const preparation = verifyPrivateTablePreparationSource(
    release.preparationReleaseId,
    rootDir,
    process.env.PRIVATE_TABLE_PREPARATION_MIGRATION_PATH?.trim() || undefined,
  );
  const activation = artifact(
    rootDir,
    process.env.PRIVATE_TABLE_RLS_ACTIVATION_MIGRATION_PATH?.trim()
      || privateTableRlsActivationMigrationPath(release),
    release.migrationSha256,
    "activation migration",
  );
  const rollback = artifact(
    rootDir,
    release.rollbackPath,
    release.rollbackSha256,
    "rollback",
  );
  if (
    !Array.isArray(release.policies)
    || new Set(release.policies.map((policy) => policy.name)).size
      !== release.policies.length
    || release.policies.some((policy) => (
      !/^[a-z][a-z0-9_]{2,63}$/u.test(policy.name)
      || !["r", "a", "w", "d"].includes(policy.command)
      || policy.permissive !== true
      || !Array.isArray(policy.roles)
      || policy.roles.length < 1
      || typeof policy.using !== "string"
      || (policy.withCheck !== null && typeof policy.withCheck !== "string")
    ))
  ) {
    throw stopped("policy catalog is invalid");
  }
  if (
    !Array.isArray(release.sourceTests)
    || release.sourceTests.length < 1
    || release.sourceTests.some((testPath) => (
      typeof testPath !== "string"
      || !/^tests\/[A-Za-z0-9._-]+\.test\.mjs$/u.test(testPath)
    ))
  ) {
    throw stopped("source-test catalog is invalid");
  }
  const quotedTable = escapeRegExp(release.table);
  const tablePattern = `public\\."${quotedTable}"`;
  const activationTableStatements = [
    ...activation.sql.matchAll(/\b(?:ALTER|LOCK)\s+TABLE\s+public\."([^"]+)"/giu),
  ].map((match) => match[1]);
  if (
    !["owner_policy_combined_enable_force", "policyless_combined_enable_force"]
      .includes(release.mode)
    || (release.mode === "policyless_combined_enable_force"
      && release.policies.length !== 0)
    || (release.mode === "owner_policy_combined_enable_force"
      && release.policies.length === 0)
    || !new RegExp(
      `ALTER\\s+TABLE\\s+${tablePattern}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "iu",
    ).test(activation.sql)
    || !new RegExp(
      `ALTER\\s+TABLE\\s+${tablePattern}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "iu",
    ).test(activation.sql)
    || !new RegExp(
      `REVOKE\\s+ALL(?:\\s+PRIVILEGES)?\\s+ON\\s+TABLE\\s+${tablePattern}[\\s\\S]*?FROM\\s+PUBLIC,\\s*grainline_app_runtime(?:,\\s*grainline_staff_read_runtime)?`,
      "iu",
    ).test(activation.sql)
    || !new RegExp(
      `LOCK\\s+TABLE\\s+${tablePattern}\\s+IN\\s+ACCESS\\s+EXCLUSIVE\\s+MODE`,
      "iu",
    ).test(activation.sql)
    || activationTableStatements.length !== 3
    || activationTableStatements.some((table) => table !== release.table)
    || /\b(?:NO\s+FORCE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/iu.test(activation.sql)
    || /\bDROP\s+(?:TABLE|COLUMN|POLICY|TRIGGER)\b/iu.test(activation.sql)
  ) {
    throw stopped("migration is not the reviewed combined activation shape");
  }
  for (const policy of release.policies) {
    if (!new RegExp(
      `CREATE\\s+POLICY\\s+${escapeRegExp(policy.name)}\\s+ON\\s+${tablePattern}`,
      "iu",
    ).test(activation.sql)) {
      throw stopped(`reviewed policy ${policy.name} is absent from activation`);
    }
  }
  const activationPolicyNames = [
    ...activation.sql.matchAll(/\bCREATE\s+POLICY\s+([a-z][a-z0-9_]*)/giu),
  ].map((match) => match[1]).sort();
  const expectedPolicyNames = release.policies.map((policy) => policy.name).sort();
  if (activationPolicyNames.join("|") !== expectedPolicyNames.join("|")) {
    throw stopped("activation policy set drifted");
  }
  const activatedPrivileges = release.activatedRuntimePrivileges.join(",\\s*");
  const activationGrant = new RegExp(
    `GRANT\\s+${activatedPrivileges}\\s+ON\\s+TABLE\\s+${tablePattern}\\s+TO\\s+grainline_app_runtime`,
    "iu",
  );
  if (
    (release.activatedRuntimePrivileges.length > 0 && !activationGrant.test(activation.sql))
    || (release.activatedRuntimePrivileges.length === 0
      && new RegExp(`GRANT[\\s\\S]{0,120}ON\\s+TABLE\\s+${tablePattern}`, "iu")
        .test(activation.sql))
  ) {
    throw stopped("activation runtime grant shape drifted");
  }
  for (const entry of preparation.release.functions) {
    const literal = signatureLiteral(entry).replaceAll("'", "''");
    if (!activation.sql.includes(`'${literal}'`)) {
      throw stopped(`reviewed operation ${literal} is absent from activation preflight`);
    }
  }
  const rollbackTableStatements = [
    ...rollback.sql.matchAll(/\b(?:ALTER|LOCK)\s+TABLE\s+public\."([^"]+)"/giu),
  ].map((match) => match[1]);
  if (
    !new RegExp(
      `GRANT\\s+SELECT,\\s*INSERT,\\s*UPDATE,\\s*DELETE\\s+ON\\s+TABLE\\s+${tablePattern}\\s+TO\\s+grainline_app_runtime`,
      "iu",
    ).test(rollback.sql)
    || !new RegExp(
      `ALTER\\s+TABLE\\s+${tablePattern}\\s+NO\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "iu",
    ).test(rollback.sql)
    || !new RegExp(
      `ALTER\\s+TABLE\\s+${tablePattern}\\s+DISABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      "iu",
    ).test(rollback.sql)
    || !new RegExp(
      `LOCK\\s+TABLE\\s+${tablePattern}\\s+IN\\s+ACCESS\\s+EXCLUSIVE\\s+MODE`,
      "iu",
    ).test(rollback.sql)
    || rollbackTableStatements.length !== 3
    || rollbackTableStatements.some((table) => table !== release.table)
    || /\b(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/iu.test(
      rollback.sql.replace(/NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/giu, ""),
    )
    || /\bCREATE\s+POLICY\b/iu.test(rollback.sql)
    || /\bDROP\s+(?:TABLE|COLUMN)\b/iu.test(rollback.sql)
  ) {
    throw stopped("rollback is not the reviewed predecessor-restoration shape");
  }
  for (const policy of release.policies) {
    if (!new RegExp(
      `DROP\\s+POLICY\\s+${escapeRegExp(policy.name)}\\s+ON\\s+${tablePattern}`,
      "iu",
    ).test(rollback.sql)) {
      throw stopped(`reviewed policy ${policy.name} is absent from rollback`);
    }
  }
  const rollbackPolicyNames = [
    ...rollback.sql.matchAll(/\bDROP\s+POLICY\s+([a-z][a-z0-9_]*)/giu),
  ].map((match) => match[1]).sort();
  if (rollbackPolicyNames.join("|") !== expectedPolicyNames.join("|")) {
    throw stopped("rollback policy set drifted");
  }
  const rollbackTriggerNames = [
    ...rollback.sql.matchAll(/\bDROP\s+TRIGGER\s+"?([A-Za-z0-9_]+)"?/giu),
  ].map((match) => match[1]).sort();
  const expectedRollbackTriggerNames = [...release.rollbackTriggerDrops].sort();
  if (rollbackTriggerNames.join("|") !== expectedRollbackTriggerNames.join("|")) {
    throw stopped("rollback trigger set drifted");
  }
  for (const change of release.functionChanges.retained) {
    const literal = signatureLiteral(change);
    if (
      !activation.sql.includes(literal)
      || !rollback.sql.includes(literal)
      || !/^[0-9a-f]{32}$/u.test(change.sourceMd5)
    ) {
      throw stopped(`retained function transition drifted for ${literal}`);
    }
  }
  const activeFunctionSources = new Map();
  for (const change of release.functionChanges.replacements) {
    const source = functionSourceFromMigration(activation.sql, change.name);
    activeFunctionSources.set(change.name, source);
    if (
      !activation.sql.includes(`RENAME TO ${change.compatibilityName}`)
      || !rollback.sql.includes(`RENAME TO ${change.name}`)
    ) {
      throw stopped(`replacement transition drifted for ${change.name}`);
    }
  }
  for (const change of release.functionChanges.additions) {
    activeFunctionSources.set(
      change.name,
      functionSourceFromMigration(activation.sql, change.name),
    );
    if (!rollback.sql.includes(`DROP FUNCTION public.${change.name}(`)) {
      throw stopped(`added function rollback drifted for ${change.name}`);
    }
  }
  return Object.freeze({
    releaseId,
    release,
    preparation,
    migrationPath: activation.path,
    migrationDigest: activation.digest,
    rollbackPath: rollback.path,
    rollbackDigest: rollback.digest,
    activeFunctionSources,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const selection = process.env.PRIVATE_TABLE_RLS_ACTIVATION_RELEASE_ID ?? "";
    const releaseIds = privateTableRlsActivationReleaseIds(selection);
    const verified = releaseIds.map((releaseId) => (
      verifyPrivateTableRlsActivationSource(releaseId)
    ));
    if (process.argv.includes("--release-ids")) {
      process.stdout.write(`${releaseIds.join("\n")}\n`);
    } else if (process.argv.includes("--preparation-release-ids")) {
      process.stdout.write(`${verified.map(
        (entry) => entry.release.preparationReleaseId,
      ).join("\n")}\n`);
    } else if (process.argv.includes("--migrations")) {
      process.stdout.write(`${verified.map((entry) => entry.release.migration).join("\n")}\n`);
    } else if (process.argv.includes("--tests")) {
      process.stdout.write(`${[...new Set(verified.flatMap(
        (entry) => entry.release.sourceTests,
      ))].join("\n")}\n`);
    } else if (process.argv.includes("--minimum-compatible-app-commit")) {
      process.stdout.write(`${verified[0].release.minimumCompatibleAppCommit}\n`);
    } else {
      process.stdout.write(`${verified[0].release.migration}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
