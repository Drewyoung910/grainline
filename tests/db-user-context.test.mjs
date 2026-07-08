import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  DB_USER_CONTEXT_DEFAULT_MAX_WAIT_MS,
  DB_USER_CONTEXT_DEFAULT_TIMEOUT_MS,
  DB_USER_CONTEXT_SERIALIZABLE_ISOLATION_LEVEL,
  DB_USER_CONTEXT_USER_ID_MAX_LENGTH,
  dbUserContextTransactionOptions,
  normalizeDbUserContextUserId,
} = await import("../src/lib/dbUserContextState.ts");

function source(path) {
  return readFileSync(path, "utf8");
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

    assert.match(helper, /use the provided transaction client for every protected\s+ \* query/);
    assert.match(helper, /Do not use `Promise\.all`/);
    assert.match(helper, /interactive transaction pins one connection/);
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
});
