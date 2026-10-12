#!/usr/bin/env node
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { postgresChannelBindingClientOptions } from "./postgres-url-safety.mjs";

const { Client } = pg;
const MIGRATION_NAME = /^[0-9]{14}_[a-z0-9_]+$/u;

const stopped = () => new Error(
  "reviewed migration pending-set check stopped; migration history or release scope drifted",
);

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function collectReviewedPendingMigrationIssues({
  directoryNames,
  rows,
  expectedPending,
}) {
  const issues = [];
  const directories = sorted(directoryNames ?? []);
  const expected = sorted(expectedPending ?? []);
  const byName = new Map();
  for (const row of rows ?? []) {
    const name = String(row?.migration_name ?? "");
    const values = byName.get(name) ?? [];
    values.push(row);
    byName.set(name, values);
  }
  const pending = [];
  for (const name of directories) {
    const matches = byName.get(name) ?? [];
    if (matches.length === 0) {
      pending.push(name);
      continue;
    }
    const successful = matches.filter((row) =>
      row.finished_at !== null
      && row.finished_at !== undefined
      && row.rolled_back_at === null
      && Number(row.applied_steps_count) === 1);
    const unresolved = matches.filter((row) =>
      row.rolled_back_at === null
      && !successful.includes(row));
    if (successful.length > 1) {
      issues.push(`migration ${name} has duplicate successful ledger rows`);
    }
    if (unresolved.length > 0) {
      issues.push(`migration ${name} has unresolved partial ledger state`);
    }
    if (successful.length === 0 && unresolved.length === 0) pending.push(name);
  }
  if (pending.join("|") !== expected.join("|")) {
    issues.push(`pending migration set drifted: ${pending.join(",") || "none"}`);
  }
  return issues;
}

export async function assertReviewedPendingMigrations({
  env = process.env,
  rootDir = process.cwd(),
  ClientImpl = Client,
} = {}) {
  const connectionString = env.DIRECT_URL;
  if (!connectionString) throw stopped();
  const expectedPending = String(env.REVIEWED_PENDING_MIGRATIONS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (expectedPending.some((name) => !MIGRATION_NAME.test(name))) throw stopped();
  const migrationsDir = path.join(rootDir, "prisma", "migrations");
  const directoryNames = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && MIGRATION_NAME.test(entry.name))
    .map((entry) => entry.name);
  const client = new ClientImpl({
    connectionString,
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    query_timeout: 20_000,
    application_name: "grainline-reviewed-pending-migrations",
  });
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query(
      `SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
         FROM public._prisma_migrations
        WHERE migration_name = ANY($1::text[])
        ORDER BY migration_name`,
      [directoryNames],
    );
    const issues = collectReviewedPendingMigrationIssues({
      directoryNames,
      rows: result.rows,
      expectedPending,
    });
    if (issues.length > 0) throw stopped();
    await client.query("COMMIT");
    return Object.freeze({
      checkedMigrationCount: directoryNames.length,
      pendingMigrationCount: expectedPending.length,
    });
  } catch {
    try { await client.query("ROLLBACK"); } catch { /* preserve bounded failure */ }
    throw stopped();
  } finally {
    try { await client.end(); } catch { /* connection is already unusable */ }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  assertReviewedPendingMigrations()
    .then((result) => process.stdout.write(
      `Reviewed pending migration set accepted: ${result.pendingMigrationCount} pending.\n`,
    ))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
