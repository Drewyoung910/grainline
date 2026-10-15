import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CI_OWNER_ROLE = "ci";
export const CI_DATABASE = "grainline_ci";

const OWNER_LITERAL_MIGRATION =
  "20260905180000_correct_order_banned_buyer_completion";
const OWNER_LITERAL = "'neondb_owner'";
const CI_OWNER_LITERAL = "'ci'";
const EXPECTED_OWNER_LITERAL_COUNT = 4;
const ROLE_CONVERGENCE_RETRY_ERRORS = new Map([
  [
    "20260801194000_enable_direct_upload_rls",
    Object.freeze([
      "grainline_direct_upload_cleanup_v2 posture is not DirectUpload-safe",
    ]),
  ],
  [
    "20260927090000_enable_order_rls",
    Object.freeze([
      "Core Order activation staff-function authority drifted",
    ]),
  ],
]);

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function findRepositoryRoot(from = process.cwd()) {
  let cursor = path.resolve(from);
  for (;;) {
    if (
      fs.existsSync(path.join(cursor, "package.json")) &&
      fs.existsSync(path.join(cursor, "prisma", "migrations")) &&
      fs.existsSync(path.join(cursor, "scripts", "prepare-ci-rls-runtime-role.sql"))
    ) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      throw new Error(`could not locate the Grainline repository from ${from}`);
    }
    cursor = parent;
  }
}

export function listMigrationArtifacts(repositoryRoot, { migrationRoot } = {}) {
  const resolvedMigrationRoot = path.resolve(
    migrationRoot ?? path.join(repositoryRoot, "prisma", "migrations"),
  );
  return fs
    .readdirSync(resolvedMigrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(resolvedMigrationRoot, entry.name, "migration.sql");
      if (!fs.existsSync(file)) return null;
      const bytes = fs.readFileSync(file);
      return Object.freeze({
        name: entry.name,
        file,
        checksum: sha256(bytes),
        sql: bytes.toString("utf8"),
      });
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function prepareMigrationSql(artifact, engine) {
  if (!artifact?.name || typeof artifact.sql !== "string") {
    throw new TypeError("a migration artifact with name and sql is required");
  }
  if (engine !== "postgres16") {
    throw new Error(`unsupported full-chain engine: ${engine}`);
  }

  let sql = artifact.sql;
  const deviations = [];
  if (artifact.name === OWNER_LITERAL_MIGRATION) {
    const count = sql.split(OWNER_LITERAL).length - 1;
    if (count !== EXPECTED_OWNER_LITERAL_COUNT) {
      throw new Error(
        `${artifact.name} owner-literal drift: expected ${EXPECTED_OWNER_LITERAL_COUNT}, found ${count}`,
      );
    }
    sql = sql.split(OWNER_LITERAL).join(CI_OWNER_LITERAL);
    deviations.push({
      kind: "ci-owner-literal",
      count,
      originalChecksum: artifact.checksum,
      preparedChecksum: sha256(sql),
    });
  }

  return Object.freeze({ sql, deviations });
}

function acceptsRoleConvergenceRetry(artifact, error) {
  const acceptedMessages = ROLE_CONVERGENCE_RETRY_ERRORS.get(artifact.name) ?? [];
  return error?.code === "P0001" && acceptedMessages.includes(error.message);
}

export function containsConcurrentIndex(sql) {
  return /\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX)\s+CONCURRENTLY\b/iu.test(
    stripSqlComments(sql),
  );
}

export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/--[^\n]*/gu, "");
}

export function splitSqlStatements(sql) {
  const statements = [];
  let buffer = "";
  let index = 0;

  const consumeQuoted = (terminator, escapeDouble = false) => {
    const start = index;
    index += terminator.length;
    while (index < sql.length) {
      if (sql.startsWith(terminator, index)) {
        if (escapeDouble && sql.startsWith(terminator + terminator, index)) {
          index += terminator.length * 2;
          continue;
        }
        index += terminator.length;
        buffer += sql.slice(start, index);
        return;
      }
      if (terminator === "'" && sql[index] === "\\") index += 2;
      else index += 1;
    }
    throw new Error(`unterminated SQL quote beginning at byte ${start}`);
  };

  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index);
      const stop = end === -1 ? sql.length : end + 1;
      buffer += sql.slice(index, stop);
      index = stop;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      const start = index;
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (sql.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth !== 0) throw new Error(`unterminated SQL comment at byte ${start}`);
      buffer += sql.slice(start, index);
      continue;
    }
    if (sql[index] === "'") {
      consumeQuoted("'", true);
      continue;
    }
    if (sql[index] === '"') {
      consumeQuoted('"', true);
      continue;
    }
    if (sql[index] === "$" && !/[A-Za-z0-9_]/u.test(sql[index - 1] ?? "")) {
      const tag = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/u)?.[0];
      if (tag) {
        consumeQuoted(tag);
        continue;
      }
    }
    const character = sql[index];
    buffer += character;
    index += 1;
    if (character === ";" && buffer.trim()) {
      statements.push(buffer);
      buffer = "";
    }
  }
  if (buffer.trim()) statements.push(buffer);
  return statements;
}

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS public."_prisma_migrations" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "checksum" varchar(64) NOT NULL,
  "finished_at" timestamptz,
  "migration_name" varchar(255) NOT NULL,
  "logs" text,
  "rolled_back_at" timestamptz,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "applied_steps_count" integer NOT NULL DEFAULT 0
)`;

export async function applyFullMigrationChain({
  adapter,
  repositoryRoot = findRepositoryRoot(),
  migrationRoot,
  engine,
  bootstrapRoles,
  convergeRoles,
  onProgress = () => {},
}) {
  if (!adapter?.query || !adapter?.executeMigration || !adapter?.resetOwner) {
    throw new TypeError("adapter must provide query, executeMigration, and resetOwner");
  }
  if (typeof bootstrapRoles !== "function" || typeof convergeRoles !== "function") {
    throw new TypeError("bootstrapRoles and convergeRoles callbacks are required");
  }

  await bootstrapRoles(adapter, repositoryRoot);
  await adapter.query(LEDGER_DDL);
  const artifacts = listMigrationArtifacts(repositoryRoot, { migrationRoot });
  const summary = {
    engine,
    migrationCount: artifacts.length,
    applied: [],
    deviations: [],
    roleConvergenceRetries: [],
  };

  for (const artifact of artifacts) {
    const { sql, deviations } = prepareMigrationSql(artifact, engine);
    const id = crypto.randomUUID();
    await adapter.query(
      `INSERT INTO public."_prisma_migrations"
        (id, checksum, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), 0)`,
      [id, artifact.checksum, artifact.name],
    );

    let firstError = null;
    try {
      await adapter.executeMigration(sql, {
        containsConcurrentIndex: containsConcurrentIndex(sql),
        migrationName: artifact.name,
      });
    } catch (error) {
      firstError = error;
      await adapter.resetOwner();
      if (!acceptsRoleConvergenceRetry(artifact, error)) {
        await adapter.query(
          `UPDATE public."_prisma_migrations" SET logs = $2 WHERE id = $1`,
          [id, `[${error.code ?? "unknown"}] ${error.message}`],
        );
        throw error;
      }
      summary.roleConvergenceRetries.push({
        migration: artifact.name,
        code: error.code,
        message: error.message,
      });
      await convergeRoles(adapter, repositoryRoot, { migration: artifact.name, error });
      try {
        await adapter.executeMigration(sql, {
          containsConcurrentIndex: containsConcurrentIndex(sql),
          migrationName: artifact.name,
        });
      } catch (retryError) {
        await adapter.resetOwner();
        await adapter.query(
          `UPDATE public."_prisma_migrations" SET logs = $2 WHERE id = $1`,
          [id, `[${retryError.code ?? "unknown"}] ${retryError.message}`],
        );
        throw retryError;
      }
    }
    await adapter.resetOwner();
    await adapter.query(
      `UPDATE public."_prisma_migrations"
          SET finished_at = now(), applied_steps_count = 1
        WHERE id = $1`,
      [id],
    );
    summary.applied.push(artifact.name);
    if (deviations.length) {
      summary.deviations.push({ migration: artifact.name, deviations });
    }
    onProgress({
      name: artifact.name,
      index: summary.applied.length,
      total: artifacts.length,
      retried: Boolean(firstError),
    });
  }

  await convergeRoles(adapter, repositoryRoot, { migration: null, error: null });
  return summary;
}
