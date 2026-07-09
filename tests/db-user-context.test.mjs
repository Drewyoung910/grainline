import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import pg from "pg";

const {
  DB_USER_CONTEXT_DEFAULT_MAX_WAIT_MS,
  DB_USER_CONTEXT_DEFAULT_TIMEOUT_MS,
  DB_USER_CONTEXT_SERIALIZABLE_ISOLATION_LEVEL,
  DB_USER_CONTEXT_USER_ID_MAX_LENGTH,
  dbUserContextTransactionOptions,
  normalizeDbUserContextUserId,
} = await import("../src/lib/dbUserContextState.ts");

function source(filePath) {
  return readFileSync(filePath, "utf8");
}

const { Client } = pg;

let aliasResolverInstalled = false;

function installSrcAliasResolver() {
  if (aliasResolverInstalled) return;
  aliasResolverInstalled = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        const relative = specifier.slice(2);
        const filePath = path.join(
          process.cwd(),
          "src",
          relative.endsWith(".ts") ? relative : `${relative}.ts`,
        );
        return nextResolve(pathToFileURL(filePath).href, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

function helperIntegrationSkipReason() {
  if (process.env.GITHUB_ACTIONS !== "true") return "requires the GitHub Actions Postgres service";
  if (!process.env.DATABASE_URL) return "requires DATABASE_URL";
  return false;
}

function assertSafeIdentifier(value) {
  assert.match(value, /^[a-z_][a-z0-9_]*$/);
  return `"${value}"`;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseUrlForRole(connectionString, role, password) {
  const url = new URL(connectionString);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function withClient(connectionString, fn) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe("RLS database user context helper", () => {
  it("bounds exact local user ids used for app.user_id", () => {
    assert.equal(normalizeDbUserContextUserId("user_123-test.id:local"), "user_123-test.id:local");
    assert.throws(() => normalizeDbUserContextUserId(""), /bounded local user id/);
    assert.throws(() => normalizeDbUserContextUserId("   "), /bounded local user id/);
    assert.throws(() => normalizeDbUserContextUserId(" user_123-test.id:local "), /bounded local user id/);
    assert.throws(() => normalizeDbUserContextUserId("user 123"), /bounded local user id/);
    assert.throws(() => normalizeDbUserContextUserId("user\n123"), /bounded local user id/);
    assert.throws(() => normalizeDbUserContextUserId("x".repeat(DB_USER_CONTEXT_USER_ID_MAX_LENGTH + 1)), /bounded local user id/);
  });

  it("uses explicit interactive transaction timeout defaults", () => {
    assert.deepEqual(dbUserContextTransactionOptions(), {
      isolationLevel: undefined,
      maxWait: DB_USER_CONTEXT_DEFAULT_MAX_WAIT_MS,
      timeout: DB_USER_CONTEXT_DEFAULT_TIMEOUT_MS,
    });
    assert.deepEqual(dbUserContextTransactionOptions({ maxWait: 20, timeout: 30 }), {
      isolationLevel: undefined,
      maxWait: 20,
      timeout: 30,
    });
    assert.deepEqual(dbUserContextTransactionOptions({ serializableRetry: true }), {
      isolationLevel: DB_USER_CONTEXT_SERIALIZABLE_ISOLATION_LEVEL,
      maxWait: DB_USER_CONTEXT_DEFAULT_MAX_WAIT_MS,
      timeout: DB_USER_CONTEXT_DEFAULT_TIMEOUT_MS,
    });
    assert.deepEqual(dbUserContextTransactionOptions({ serializableRetry: true, maxWait: 20, timeout: 30 }), {
      isolationLevel: DB_USER_CONTEXT_SERIALIZABLE_ISOLATION_LEVEL,
      maxWait: 20,
      timeout: 30,
    });
    assert.throws(
      () => dbUserContextTransactionOptions({ serializableRetry: true, isolationLevel: "ReadCommitted" }),
      /requires Serializable isolation/,
    );
  });

  it("sets transaction-local app.user_id with a parameterized query", () => {
    const helper = source("src/lib/dbUserContext.ts");

    assert.match(helper, /SELECT set_config\('app\.user_id', \$\{normalizedUserId\}, true\) AS user_id/);
    assert.doesNotMatch(helper, /\$queryRawUnsafe/);
    assert.match(helper, /rows\[0\]\?\.user_id !== normalizedUserId/);
  });

  it("sets context before caller work inside the interactive transaction", () => {
    const helper = source("src/lib/dbUserContext.ts");
    const transactionStart = helper.indexOf("prisma.$transaction(async (tx) => {");
    const contextSet = helper.indexOf("await setDbUserContext(tx, normalizedUserId);", transactionStart);
    const operation = helper.indexOf("return operation(tx);", transactionStart);

    assert.notEqual(transactionStart, -1);
    assert.notEqual(contextSet, -1);
    assert.notEqual(operation, -1);
    assert.ok(contextSet < operation);
  });

  it("documents the sequential transaction-client contract for future callers", () => {
    const helper = source("src/lib/dbUserContext.ts");

    assert.match(helper, /server-resolved authenticated local User\.id/);
    assert.match(helper, /Never pass request body, query string, route param, or other client-supplied/);
    assert.match(helper, /use the provided transaction client for every protected\s+ \* query/);
    assert.match(helper, /Do not use `Promise\.all`/);
    assert.match(helper, /interactive transaction pins one connection/);
    assert.match(helper, /Keep\s+ \* the callback DB-only and fast/);
    assert.match(helper, /do not await external or network calls inside/);
  });

  it("keeps serializable retry outside the transaction so context is reset per attempt", () => {
    const helper = source("src/lib/dbUserContext.ts");
    const runTransaction = helper.indexOf("const runTransaction = () =>");
    const transactionStart = helper.indexOf("prisma.$transaction(async (tx) => {", runTransaction);
    const retry = helper.indexOf("withSerializableRetry(runTransaction, options.attempts)", transactionStart);

    assert.notEqual(runTransaction, -1);
    assert.notEqual(transactionStart, -1);
    assert.notEqual(retry, -1);
    assert.match(helper, /const transactionOptions = dbUserContextTransactionOptions\(options\);/);
    assert.match(helper, /Omit<WithDbUserContextOptions, "serializableRetry" \| "isolationLevel">/);
  });

  it("executes the helper against a forced RLS canary with a non-owner runtime role", { skip: helperIntegrationSkipReason() }, async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const runtimeRole = `rls_helper_runtime_${suffix}`;
    const runtimePassword = `run_${suffix}_pw`;
    const tableName = `rls_helper_canary_${suffix}`;
    const policyName = `rls_helper_policy_${suffix}`;
    const adminUrl = process.env.DATABASE_URL;
    const runtimeUrl = databaseUrlForRole(adminUrl, runtimeRole, runtimePassword);
    let prisma;

    async function cleanup() {
      await withClient(adminUrl, async (admin) => {
        await admin.query(`DROP TABLE IF EXISTS ${assertSafeIdentifier(tableName)}`).catch(() => {});
        await admin.query(`DROP ROLE IF EXISTS ${assertSafeIdentifier(runtimeRole)}`).catch(() => {});
      });
    }

    await cleanup();

    await withClient(adminUrl, async (admin) => {
      const databaseResult = await admin.query("SELECT current_database() AS database_name");
      const databaseName = databaseResult.rows[0].database_name;
      await admin.query(`CREATE ROLE ${assertSafeIdentifier(runtimeRole)} LOGIN PASSWORD ${sqlLiteral(runtimePassword)}`);
      await admin.query(`GRANT CONNECT ON DATABASE ${assertSafeIdentifier(databaseName)} TO ${assertSafeIdentifier(runtimeRole)}`);
      await admin.query(`GRANT USAGE ON SCHEMA public TO ${assertSafeIdentifier(runtimeRole)}`);
      await admin.query(
        `CREATE TABLE ${assertSafeIdentifier(tableName)} (
          id text PRIMARY KEY,
          owner_id text NOT NULL
        )`,
      );
      await admin.query(
        `INSERT INTO ${assertSafeIdentifier(tableName)} (id, owner_id)
         VALUES ('row-user-a', 'user_a'), ('row-user-b', 'user_b')`,
      );
      await admin.query(`ALTER TABLE ${assertSafeIdentifier(tableName)} ENABLE ROW LEVEL SECURITY`);
      await admin.query(`ALTER TABLE ${assertSafeIdentifier(tableName)} FORCE ROW LEVEL SECURITY`);
      await admin.query(
        `CREATE POLICY ${assertSafeIdentifier(policyName)}
           ON ${assertSafeIdentifier(tableName)}
          FOR SELECT
        USING (owner_id = current_setting('app.user_id', true))`,
      );
      await admin.query(`GRANT SELECT ON TABLE ${assertSafeIdentifier(tableName)} TO ${assertSafeIdentifier(runtimeRole)}`);
    });

    const originalDatabaseUrl = process.env.DATABASE_URL;
    const globalForPrisma = globalThis;
    const previousPrisma = globalForPrisma.prisma;

    try {
      delete globalForPrisma.prisma;
      process.env.DATABASE_URL = runtimeUrl;
      installSrcAliasResolver();

      const helperModule = await import("../src/lib/dbUserContext.ts");
      const dbModule = await import("../src/lib/db.ts");
      prisma = dbModule.prisma;

      const rowsForUserA = await helperModule.withDbUserContext("user_a", (tx) =>
        tx.$queryRawUnsafe(`SELECT id FROM ${assertSafeIdentifier(tableName)} ORDER BY id`),
      );
      assert.deepEqual(rowsForUserA, [{ id: "row-user-a" }]);

      const rowsForUserB = await helperModule.withDbUserContext("user_b", (tx) =>
        tx.$queryRawUnsafe(`SELECT id FROM ${assertSafeIdentifier(tableName)} ORDER BY id`),
      );
      assert.deepEqual(rowsForUserB, [{ id: "row-user-b" }]);

      const rowsWithoutContext = await prisma.$queryRawUnsafe(`SELECT id FROM ${assertSafeIdentifier(tableName)} ORDER BY id`);
      assert.deepEqual(rowsWithoutContext, []);

      const contextAfterCommit = await prisma.$queryRaw`SELECT current_setting('app.user_id', true) AS user_id`;
      assert.ok(
        contextAfterCommit[0]?.user_id === null || contextAfterCommit[0]?.user_id === "",
        "transaction-local app.user_id should clear after commit",
      );

      const isolationRows = await helperModule.withSerializableDbUserContext("user_a", (tx) =>
        tx.$queryRaw`SHOW transaction_isolation`,
      );
      assert.equal(isolationRows[0]?.transaction_isolation, "serializable");
    } finally {
      if (prisma) await prisma.$disconnect();
      process.env.DATABASE_URL = originalDatabaseUrl;
      if (previousPrisma) {
        globalForPrisma.prisma = previousPrisma;
      } else {
        delete globalForPrisma.prisma;
      }
      await cleanup();
    }
  });
});
