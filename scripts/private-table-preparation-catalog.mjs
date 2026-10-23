#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_ID_PATTERN = /^[a-z][a-z0-9_]{2,63}$/u;

export const PRIVATE_TABLE_PREPARATION_CONFIRMATION =
  "apply-reviewed-private-table-preparation";

export const PRIVATE_TABLE_PREPARATIONS = Object.freeze({
  support_request_v1: Object.freeze({
    migration: "20261023010000_prepare_support_request_authorities",
    migrationSha256: "c65e259df2bd476e2d265c8973fabbcf018b5f989b4b01a2ca923bb1013dc384",
    table: "SupportRequest",
    expectedPredecessorPosture: Object.freeze({
      rlsEnabled: false,
      rlsForced: false,
      policyCount: 0,
      runtimeSelect: true,
      runtimeInsert: true,
      runtimeUpdate: true,
      runtimeDelete: true,
      staffSelect: false,
      publicSelect: false,
    }),
    addedColumns: Object.freeze([
      Object.freeze({ name: "emailDeliveryToken", type: "uuid", nullable: true }),
    ]),
    functions: Object.freeze([
      Object.freeze({
        name: "grainline_support_request_submit",
        arguments: "text, text, text, text, text, text, text",
      }),
      Object.freeze({
        name: "grainline_support_request_delivery_record",
        arguments: "text, uuid, boolean, text",
      }),
      Object.freeze({ name: "grainline_support_request_owner_export", arguments: "" }),
      Object.freeze({
        name: "grainline_support_request_staff_state",
        arguments: "integer, integer, integer",
      }),
      Object.freeze({
        name: "grainline_support_request_staff_transition",
        arguments: "text, text, text",
      }),
      Object.freeze({
        name: "grainline_support_request_account_deletion_redact_batch",
        arguments: "text[], text[]",
      }),
      Object.freeze({
        name: "grainline_support_request_provider_deletion_upsert",
        arguments: "text",
      }),
      Object.freeze({ name: "grainline_support_request_overdue_count", arguments: "" }),
      Object.freeze({
        name: "grainline_support_request_retention_delete_batch",
        arguments: "integer",
      }),
    ]),
  }),
});

function stopped(message) {
  return new Error(`private-table preparation stopped: ${message}`);
}

export function privateTablePreparation(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID_PATTERN.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = PRIVATE_TABLE_PREPARATIONS[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  return release;
}

export function privateTablePreparationMigrationPath(release) {
  return `prisma/migrations/${release.migration}/migration.sql`;
}

export function functionSourceFromMigration(sql, name) {
  const delimiter = `$${name}$`;
  const marker = `AS ${delimiter}`;
  const start = sql.indexOf(marker);
  if (start < 0) throw stopped(`function source is absent for ${name}`);
  const bodyStart = start + marker.length;
  const end = sql.indexOf(`${delimiter};`, bodyStart);
  if (end < 0 || end === bodyStart) {
    throw stopped(`function source delimiter is invalid for ${name}`);
  }
  return sql.slice(bodyStart, end);
}

export function verifyPrivateTablePreparationSource(releaseId, rootDir = process.cwd()) {
  const release = privateTablePreparation(releaseId);
  const migrationPath = path.join(
    rootDir,
    privateTablePreparationMigrationPath(release),
  );
  const bytes = readFileSync(migrationPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== release.migrationSha256) {
    throw stopped("migration digest drifted");
  }
  const sql = bytes.toString("utf8");
  if (
    /ENABLE\s+ROW\s+LEVEL\s+SECURITY/iu.test(sql)
    || /FORCE\s+ROW\s+LEVEL\s+SECURITY/iu.test(sql)
    || /REVOKE[\s\S]{0,500}\bON\s+TABLE/iu.test(sql)
    || /DROP\s+COLUMN/iu.test(sql)
  ) {
    throw stopped("compatible preparation contains activation or destructive SQL");
  }
  const functionSources = new Map(release.functions.map((entry) => [
    entry.name,
    functionSourceFromMigration(sql, entry.name),
  ]));
  return Object.freeze({ releaseId, release, migrationPath, digest, functionSources });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const releaseId = process.env.PRIVATE_TABLE_PREPARATION_RELEASE_ID ?? "";
    const verified = verifyPrivateTablePreparationSource(releaseId);
    process.stdout.write(`${verified.release.migration}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
