#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_ACCOUNT_DELETION_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-account-deletion-proof";

const ids = Object.freeze({
  target: `${PREFIX}-target`,
  counterpartyBuyer: `${PREFIX}-counterparty-buyer`,
  counterpartySeller: `${PREFIX}-counterparty-seller`,
  outsider: `${PREFIX}-outsider`,
  sharedAliasOwner: `${PREFIX}-shared-alias-owner`,
  targetSellerProfile: `${PREFIX}-target-seller-profile`,
  targetEmailHistory: `${PREFIX}-target-email-history`,
  sharedEmailHistory: `${PREFIX}-shared-email-history`,
  buyerOrder: `${PREFIX}-buyer-order`,
  sellerOrder: `${PREFIX}-seller-order`,
  unrelatedOrder: `${PREFIX}-unrelated-order`,
  activeOrder: `${PREFIX}-active-order`,
  buyerCase: `${PREFIX}-buyer-case`,
  sellerCase: `${PREFIX}-seller-case`,
  unrelatedCase: `${PREFIX}-unrelated-case`,
  activeCase: `${PREFIX}-active-case`,
  targetBuyerMessage: `${PREFIX}-target-buyer-message`,
  buyerQuoteMessage: `${PREFIX}-buyer-quote-message`,
  sharedAliasMessage: `${PREFIX}-shared-alias-message`,
  targetSellerMessage: `${PREFIX}-target-seller-message`,
  sellerQuoteMessage: `${PREFIX}-seller-quote-message`,
  unrelatedMessage: `${PREFIX}-unrelated-message`,
  source: `${PREFIX}-source`,
  wrongKindSource: `${PREFIX}-source-wrong-kind`,
  wrongDedupSource: `${PREFIX}-source-wrong-dedup`,
  wrongPayloadSource: `${PREFIX}-source-wrong-payload`,
});

const TARGET_EMAIL = "target.unique@example.invalid";
const TARGET_NAME = "Target Unique Person";
const TARGET_SHIPPING_LINE = "987 Proof Avenue";
const TARGET_SHOP_NAME = "Target Unique Workshop";
const SHARED_HISTORY_EMAIL = "shared.alias+old@gmail.com";
const SHARED_ACTIVE_EMAIL = "sharedalias@gmail.com";
const MESSAGE_DELETED = "[Message deleted]";
const DESCRIPTION_DELETED = "[Case description deleted]";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseAccountDeletionProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case account-deletion proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case account-deletion proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

function createClient(databaseUrl, applicationName) {
  return new Client({
    application_name: applicationName,
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
}

async function runtimeQuery(client, sql, params = []) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function expectSqlState(run, sqlState) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code, sqlState);
    return true;
  });
}

async function seedUser(
  client,
  id,
  {
    email = `${id}@example.invalid`,
    name = `Name ${id}`,
    shippingLine1 = null,
  } = {},
) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, "shippingLine1",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, $5,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [id, `clerk-${id}`, email, name, shippingLine1]);
}

async function seedCase(
  client,
  {
    id,
    orderId,
    buyerId,
    sellerId,
    description,
    status = "CLOSED",
  },
) {
  await client.query(
    'INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2)',
    [orderId, buyerId],
  );
  await client.query(`
    INSERT INTO public."Case" (
      id, "orderId", "buyerId", "sellerId", reason, description,
      status, "sellerRespondBy", "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4,
      'OTHER'::public."CaseReason",
      $5,
      $6::public."CaseStatus",
      CURRENT_TIMESTAMP + INTERVAL '48 hours',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `, [id, orderId, buyerId, sellerId, description, status]);
}

async function seedMessage(
  client,
  { id, caseId, authorId, authorKind, body },
) {
  await client.query(`
    INSERT INTO public."CaseMessage" (
      id, "caseId", "authorId", "authorKind", body, "createdAt"
    )
    VALUES (
      $1, $2, $3, $4::public."CaseMessageAuthorKind", $5,
      CURRENT_TIMESTAMP
    )
  `, [id, caseId, authorId, authorKind, body]);
}

async function seedSideEffect(
  client,
  { id, kind = "LOCAL_ANONYMIZE", dedupKey, payload = {} },
) {
  await client.query(`
    INSERT INTO public."AccountDeletionSideEffect" (
      id, "userId", kind, "dedupKey", payload, status,
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, $5::jsonb, 'PENDING',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [id, ids.target, kind, dedupKey, JSON.stringify(payload)]);
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedUser(client, ids.target, {
      email: TARGET_EMAIL,
      name: TARGET_NAME,
      shippingLine1: TARGET_SHIPPING_LINE,
    });
    await seedUser(client, ids.counterpartyBuyer);
    await seedUser(client, ids.counterpartySeller);
    await seedUser(client, ids.outsider);
    await seedUser(client, ids.sharedAliasOwner, {
      email: SHARED_ACTIVE_EMAIL,
    });
    await client.query(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized",
        "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      ids.targetSellerProfile,
      ids.target,
      TARGET_SHOP_NAME,
      TARGET_SHOP_NAME.toLowerCase(),
    ]);
    await client.query(`
      INSERT INTO public."UserEmailAddress" (
        id, "userId", email, source, "isCurrent",
        "firstSeenAt", "lastSeenAt", "currentSinceAt"
      )
      VALUES
        ($1, $2, $3, 'proof', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ($4, $2, $5, 'proof', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      ids.targetEmailHistory,
      ids.target,
      "historical.unique@example.invalid",
      ids.sharedEmailHistory,
      SHARED_HISTORY_EMAIL,
    ]);

    await seedCase(client, {
      id: ids.buyerCase,
      orderId: ids.buyerOrder,
      buyerId: ids.target,
      sellerId: ids.counterpartySeller,
      description: `${TARGET_NAME} at ${TARGET_SHIPPING_LINE}`,
    });
    await seedCase(client, {
      id: ids.sellerCase,
      orderId: ids.sellerOrder,
      buyerId: ids.counterpartyBuyer,
      sellerId: ids.target,
      description: `Seller ${TARGET_SHOP_NAME} uses ${TARGET_EMAIL}`,
      status: "RESOLVED",
    });
    await seedCase(client, {
      id: ids.unrelatedCase,
      orderId: ids.unrelatedOrder,
      buyerId: ids.outsider,
      sellerId: ids.counterpartySeller,
      description: `Unrelated record mentions ${TARGET_EMAIL}`,
    });
    await seedCase(client, {
      id: ids.activeCase,
      orderId: ids.activeOrder,
      buyerId: ids.target,
      sellerId: ids.counterpartySeller,
      description: "Active deletion blocker",
      status: "OPEN",
    });

    await seedMessage(client, {
      id: ids.targetBuyerMessage,
      caseId: ids.buyerCase,
      authorId: ids.target,
      authorKind: "BUYER",
      body: `Authored by ${TARGET_NAME}`,
    });
    await seedMessage(client, {
      id: ids.buyerQuoteMessage,
      caseId: ids.buyerCase,
      authorId: ids.counterpartySeller,
      authorKind: "SELLER",
      body: `Buyer said ${TARGET_EMAIL} and ${TARGET_SHIPPING_LINE}`,
    });
    await seedMessage(client, {
      id: ids.sharedAliasMessage,
      caseId: ids.buyerCase,
      authorId: ids.counterpartySeller,
      authorKind: "SELLER",
      body: `Preserve claimed alias ${SHARED_HISTORY_EMAIL}`,
    });
    await seedMessage(client, {
      id: ids.targetSellerMessage,
      caseId: ids.sellerCase,
      authorId: ids.target,
      authorKind: "SELLER",
      body: `Authored by ${TARGET_SHOP_NAME}`,
    });
    await seedMessage(client, {
      id: ids.sellerQuoteMessage,
      caseId: ids.sellerCase,
      authorId: ids.counterpartyBuyer,
      authorKind: "BUYER",
      body: `Shop ${TARGET_SHOP_NAME} belongs to ${TARGET_NAME}`,
    });
    await seedMessage(client, {
      id: ids.unrelatedMessage,
      caseId: ids.unrelatedCase,
      authorId: ids.outsider,
      authorKind: "BUYER",
      body: `Unrelated record mentions ${TARGET_EMAIL}`,
    });

    await seedSideEffect(client, {
      id: ids.source,
      dedupKey: `account-delete:local:${ids.target}`,
    });
    await seedSideEffect(client, {
      id: ids.wrongKindSource,
      kind: "CLERK_DELETE",
      dedupKey: `${PREFIX}:wrong-kind`,
    });
    await seedSideEffect(client, {
      id: ids.wrongDedupSource,
      dedupKey: `${PREFIX}:wrong-dedup`,
    });
    await seedSideEffect(client, {
      id: ids.wrongPayloadSource,
      dedupKey: `${PREFIX}:wrong-payload`,
      payload: { callerControlled: true },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function fixtureCounts(client) {
  const result = await client.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer
         FROM public."User" WHERE id LIKE $1) AS users,
      (SELECT pg_catalog.count(*)::integer
         FROM public."SellerProfile" WHERE id LIKE $1) AS seller_profiles,
      (SELECT pg_catalog.count(*)::integer
         FROM public."UserEmailAddress" WHERE id LIKE $1) AS email_addresses,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Order" WHERE id LIKE $1) AS orders,
      (SELECT pg_catalog.count(*)::integer
         FROM public."Case" WHERE id LIKE $1) AS cases,
      (SELECT pg_catalog.count(*)::integer
         FROM public."CaseMessage" WHERE id LIKE $1) AS messages,
      (SELECT pg_catalog.count(*)::integer
         FROM public."AccountDeletionSideEffect" WHERE id LIKE $1) AS side_effects
  `, [`${PREFIX}%`]);
  return result.rows[0];
}

const SEEDED_COUNTS = Object.freeze({
  users: 5,
  seller_profiles: 1,
  email_addresses: 2,
  orders: 4,
  cases: 4,
  messages: 6,
  side_effects: 4,
});

const ZERO_COUNTS = Object.freeze({
  users: 0,
  seller_profiles: 0,
  email_addresses: 0,
  orders: 0,
  cases: 0,
  messages: 0,
  side_effects: 0,
});

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(
      'DELETE FROM public."CaseMessage" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Case" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Order" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."AccountDeletionSideEffect" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."User" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function enableProofRls(client) {
  for (const table of ["Case", "CaseMessage"]) {
    await client.query(
      `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`,
    );
    await client.query(
      `ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`,
    );
  }
}

async function disableProofRls(client) {
  for (const table of ["CaseMessage", "Case"]) {
    await client.query(
      `ALTER TABLE public."${table}" NO FORCE ROW LEVEL SECURITY`,
    ).catch(() => {});
    await client.query(
      `ALTER TABLE public."${table}" DISABLE ROW LEVEL SECURITY`,
    ).catch(() => {});
  }
}

async function blockerCount(client) {
  const result = await runtimeQuery(
    client,
    "SELECT public.grainline_case_account_deletion_blockers($1) AS count",
    [ids.target],
  );
  return Number(result.rows[0]?.count);
}

async function redact(client, sourceId = ids.source) {
  return runtimeQuery(
    client,
    "SELECT * FROM public.grainline_case_account_deletion_redact($1)",
    [sourceId],
  );
}

async function fetchProtectedRows(client) {
  const result = await client.query(`
    SELECT
      (SELECT jsonb_object_agg(id, body ORDER BY id)
         FROM public."CaseMessage"
        WHERE id LIKE $1) AS messages,
      (SELECT jsonb_object_agg(id, description ORDER BY id)
         FROM public."Case"
        WHERE id LIKE $1) AS cases
  `, [`${PREFIX}%`]);
  return result.rows[0];
}

function assertOriginalProtectedRows(rows) {
  assert.equal(
    rows.messages[ids.targetBuyerMessage],
    `Authored by ${TARGET_NAME}`,
  );
  assert.equal(
    rows.messages[ids.targetSellerMessage],
    `Authored by ${TARGET_SHOP_NAME}`,
  );
  assert.equal(
    rows.cases[ids.buyerCase],
    `${TARGET_NAME} at ${TARGET_SHIPPING_LINE}`,
  );
  assert.match(rows.cases[ids.sellerCase], /Target Unique Workshop/);
}

function assertRedactedProtectedRows(rows) {
  assert.equal(rows.messages[ids.targetBuyerMessage], MESSAGE_DELETED);
  assert.equal(rows.messages[ids.targetSellerMessage], MESSAGE_DELETED);
  assert.doesNotMatch(rows.messages[ids.buyerQuoteMessage], /target\.unique|987 Proof/i);
  assert.doesNotMatch(rows.messages[ids.sellerQuoteMessage], /Target Unique/i);
  assert.equal(
    rows.messages[ids.sharedAliasMessage],
    `Preserve claimed alias ${SHARED_HISTORY_EMAIL}`,
  );
  assert.equal(
    rows.messages[ids.unrelatedMessage],
    `Unrelated record mentions ${TARGET_EMAIL}`,
  );
  assert.equal(rows.cases[ids.buyerCase], DESCRIPTION_DELETED);
  assert.doesNotMatch(rows.cases[ids.sellerCase], /Target Unique|target\.unique/i);
  assert.equal(
    rows.cases[ids.unrelatedCase],
    `Unrelated record mentions ${TARGET_EMAIL}`,
  );
}

export async function runCaseAccountDeletionAuthorityProof(
  env = process.env,
) {
  const { databaseUrl } = parseCaseAccountDeletionProofConfig(env);
  const owner = createClient(databaseUrl, `${PREFIX}-owner`);
  const runtime = createClient(databaseUrl, `${PREFIX}-runtime`);
  const contender = createClient(databaseUrl, `${PREFIX}-contender`);
  const checks = [];
  let proofRlsEnabled = false;
  await owner.connect();
  await runtime.connect();
  await contender.connect();
  try {
    assert.deepEqual(
      await fixtureCounts(owner),
      ZERO_COUNTS,
      "Case account-deletion proof found pre-existing fixtures",
    );
    checks.push("preflight-zero-residue");
    await seedFixtures(owner);
    assert.deepEqual(await fixtureCounts(owner), SEEDED_COUNTS);
    checks.push("fixtures-seeded");

    const catalog = await owner.query(`
      SELECT
        procedure.proname,
        procedure.prosecdef,
        procedure.provolatile,
        procedure.proparallel,
        procedure.proconfig,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          procedure.oid,
          'EXECUTE'
        ) AS runtime_execute,
        pg_catalog.has_function_privilege(
          'public',
          procedure.oid,
          'EXECUTE'
        ) AS public_execute
        FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid IN (
         'public.grainline_case_account_deletion_blockers(text)'
           ::pg_catalog.regprocedure,
         'public.grainline_case_account_deletion_redact(text)'
           ::pg_catalog.regprocedure
       )
       ORDER BY procedure.proname
    `);
    assert.deepEqual(catalog.rows, [
      {
        proname: "grainline_case_account_deletion_blockers",
        prosecdef: true,
        provolatile: "s",
        proparallel: "u",
        proconfig: ["search_path=pg_catalog"],
        runtime_execute: true,
        public_execute: false,
      },
      {
        proname: "grainline_case_account_deletion_redact",
        prosecdef: true,
        provolatile: "v",
        proparallel: "u",
        proconfig: ["search_path=pg_catalog"],
        runtime_execute: true,
        public_execute: false,
      },
    ]);
    checks.push("catalog-and-grants");

    const originalRls = await owner.query(`
      SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_catalog.pg_class
       WHERE oid IN (
         'public."Case"'::pg_catalog.regclass,
         'public."CaseMessage"'::pg_catalog.regclass
       )
       ORDER BY relname
    `);
    assert.equal(
      originalRls.rows.every(
        (row) => !row.relrowsecurity && !row.relforcerowsecurity,
      ),
      true,
      "Case account-deletion proof requires compatible pre-RLS posture",
    );
    proofRlsEnabled = true;
    await enableProofRls(owner);
    checks.push("forced-zero-policy-posture");

    assert.equal(await blockerCount(runtime), 1);
    await expectSqlState(() => redact(runtime), "55000");
    assertOriginalProtectedRows(await fetchProtectedRows(owner));
    checks.push("active-case-fail-closed");

    await owner.query(
      'DELETE FROM public."Case" WHERE id = $1',
      [ids.activeCase],
    );
    await owner.query(
      'DELETE FROM public."Order" WHERE id = $1',
      [ids.activeOrder],
    );
    assert.equal(await blockerCount(runtime), 0);
    checks.push("blocker-clears-only-after-active-case-removal");

    for (const [sourceId, sqlState] of [
      [`${PREFIX}-missing-source`, "23503"],
      [ids.wrongKindSource, "42501"],
      [ids.wrongDedupSource, "42501"],
      [ids.wrongPayloadSource, "42501"],
    ]) {
      await expectSqlState(() => redact(runtime, sourceId), sqlState);
    }
    checks.push("forged-source-denial");

    await runtime.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    await expectSqlState(
      () => runtime.query(
        "SELECT * FROM public.grainline_case_account_deletion_redact($1)",
        [ids.source],
      ),
      "25001",
    );
    await runtime.query("ROLLBACK");
    checks.push("isolation-fail-closed");

    const directCases = await runtimeQuery(
      runtime,
      'SELECT pg_catalog.count(*)::integer AS count FROM public."Case"',
    );
    const directMessages = await runtimeQuery(
      runtime,
      'SELECT pg_catalog.count(*)::integer AS count FROM public."CaseMessage"',
    );
    const directUpdate = await runtimeQuery(
      runtime,
      'UPDATE public."CaseMessage" SET body = $1 WHERE id = $2',
      ["forged", ids.targetBuyerMessage],
    );
    assert.equal(directCases.rows[0]?.count, 0);
    assert.equal(directMessages.rows[0]?.count, 0);
    assert.equal(directUpdate.rowCount, 0);
    checks.push("direct-runtime-boundary");

    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const rolledBack = await runtime.query(
      "SELECT * FROM public.grainline_case_account_deletion_redact($1)",
      [ids.source],
    );
    assert.deepEqual(rolledBack.rows, [{
      sideEffectId: ids.source,
      userId: ids.target,
      authoredMessagesRedacted: 2,
      quotedMessagesRedacted: 2,
      buyerDescriptionsRedacted: 1,
      participantDescriptionsRedacted: 1,
    }]);
    await runtime.query("ROLLBACK");
    assertOriginalProtectedRows(await fetchProtectedRows(owner));
    checks.push("transaction-rollback");

    await runtime.query("BEGIN");
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    await runtime.query(
      "SELECT * FROM public.grainline_case_account_deletion_redact($1)",
      [ids.source],
    );
    await contender.query("BEGIN");
    await contender.query("SET LOCAL lock_timeout = '200ms'");
    await expectSqlState(
      () => contender.query(
        'SELECT id FROM public."User" WHERE id = $1 FOR SHARE',
        [ids.target],
      ),
      "55P03",
    );
    await contender.query("ROLLBACK");
    await runtime.query("ROLLBACK");
    assertOriginalProtectedRows(await fetchProtectedRows(owner));
    checks.push("user-lock-serialization");

    const committed = await redact(runtime);
    assert.deepEqual(committed.rows, [{
      sideEffectId: ids.source,
      userId: ids.target,
      authoredMessagesRedacted: 2,
      quotedMessagesRedacted: 2,
      buyerDescriptionsRedacted: 1,
      participantDescriptionsRedacted: 1,
    }]);
    assertRedactedProtectedRows(await fetchProtectedRows(owner));
    checks.push("derived-redaction-commit");

    const retry = await redact(runtime);
    assert.deepEqual(retry.rows, [{
      sideEffectId: ids.source,
      userId: ids.target,
      authoredMessagesRedacted: 0,
      quotedMessagesRedacted: 0,
      buyerDescriptionsRedacted: 0,
      participantDescriptionsRedacted: 0,
    }]);
    assertRedactedProtectedRows(await fetchProtectedRows(owner));
    checks.push("idempotent-retry");

    assert.deepEqual(
      await fixtureCounts(owner),
      {
        ...SEEDED_COUNTS,
        orders: 3,
        cases: 3,
      },
      "Case account-deletion proof changed protected row identity",
    );
    checks.push("expected-state-before-cleanup");
  } finally {
    await runtime.query("ROLLBACK").catch(() => {});
    await contender.query("ROLLBACK").catch(() => {});
    if (proofRlsEnabled) {
      await disableProofRls(owner);
    }
    await cleanupFixtures(owner).catch(() => {});
    const residue = await fixtureCounts(owner).catch(() => null);
    await Promise.all([
      owner.end().catch(() => {}),
      runtime.end().catch(() => {}),
      contender.end().catch(() => {}),
    ]);
    assert.deepEqual(
      residue,
      ZERO_COUNTS,
      "Case account-deletion proof left fixture residue",
    );
  }
  checks.push("cleanup-zero-residue");
  assert.equal(checks.length, 15);
  return Object.freeze({ checks: Object.freeze([...checks]) });
}

const isDirectRun =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  runCaseAccountDeletionAuthorityProof()
    .then(({ checks }) => {
      process.stdout.write(
        `Case account-deletion PostgreSQL proof passed ${checks.length} checks.\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(
        `Case account-deletion PostgreSQL proof failed: ${safeError(error)}\n`,
      );
      process.exitCode = 1;
    });
}
