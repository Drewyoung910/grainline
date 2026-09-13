#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_MESSAGE_PREFLIGHT_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-message-preflight-proof";

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  seller: `${PREFIX}-seller`,
  foreign: `${PREFIX}-foreign`,
  staff: `${PREFIX}-staff`,
  deletedBuyer: `${PREFIX}-deleted-buyer`,
  suspendedSeller: `${PREFIX}-suspended-seller`,
  suspendedActor: `${PREFIX}-suspended-actor`,
  openCase: `${PREFIX}-case-open`,
  underReviewCase: `${PREFIX}-case-under-review`,
  closedCase: `${PREFIX}-case-closed`,
  missingBuyerCase: `${PREFIX}-case-missing-buyer`,
  deletedBuyerCase: `${PREFIX}-case-deleted-buyer`,
  suspendedSellerCase: `${PREFIX}-case-suspended-seller`,
  suspendedActorCase: `${PREFIX}-case-suspended-actor`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseMessagePreflightProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case-message preflight proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case-message preflight proof requires the ${DATABASE_NAME} database`,
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

function orderId(caseId) {
  return caseId.replace("-case-", "-order-");
}

function sellerProfileId(userId) {
  return `${userId}-profile`;
}

function listingId(userId) {
  return `${userId}-listing`;
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

async function preflight(client, actorId, caseId) {
  const result = await runtimeQuery(
    client,
    "SELECT * FROM public.grainline_case_message_preflight($1, $2)",
    [actorId, caseId],
  );
  assert.ok(result.rowCount === 0 || result.rowCount === 1);
  return result.rows[0] ?? null;
}

async function seedUsers(client) {
  const users = [
    [ids.buyer, "USER", false, null],
    [ids.seller, "USER", false, null],
    [ids.foreign, "USER", false, null],
    [ids.staff, "EMPLOYEE", false, null],
    [ids.deletedBuyer, "USER", false, new Date()],
    [ids.suspendedSeller, "USER", true, null],
    [ids.suspendedActor, "USER", true, null],
  ];
  for (const [id, role, banned, deletedAt] of users) {
    await client.query(`
      INSERT INTO public."User" (
        id, "clerkId", email, name, role, banned, "deletedAt",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5::public."Role", $6, $7,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [
      id,
      `clerk-${id}`,
      `${id}@example.invalid`,
      id,
      role,
      banned,
      deletedAt,
    ]);
  }
}

async function seedSellerRelationship(client, userId) {
  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [
    sellerProfileId(userId),
    userId,
    `Seller ${userId}`,
    `seller ${userId}`,
  ]);
  await client.query(`
    INSERT INTO public."Listing" (
      id, "sellerId", title, description, "priceCents",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3,
      'Disposable loopback-only Case-message preflight proof.',
      1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [
    listingId(userId),
    sellerProfileId(userId),
    `Listing ${userId}`,
  ]);
}

async function seedCase(client, caseId, status, buyerId, sellerId) {
  const targetOrderId = orderId(caseId);
  await client.query(`
    INSERT INTO public."Order" (id, "buyerId")
    VALUES ($1, $2)
  `, [targetOrderId, buyerId]);
  await client.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", quantity, "priceCents"
    )
    VALUES ($1, $2, $3, 1, 1000)
  `, [
    `${targetOrderId}-item`,
    targetOrderId,
    listingId(sellerId),
  ]);
  await client.query(`
    INSERT INTO public."Case" (
      id, "orderId", "buyerId", "sellerId", reason, description,
      status, resolution, "sellerRespondBy", "resolvedAt",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, $3, $4, 'OTHER',
      'Disposable loopback-only Case-message preflight proof.',
      $5::public."CaseStatus",
      CASE WHEN $5 IN ('RESOLVED', 'CLOSED')
        THEN 'DISMISSED'::public."CaseResolution"
        ELSE NULL
      END,
      CURRENT_TIMESTAMP + INTERVAL '48 hours',
      CASE WHEN $5 IN ('RESOLVED', 'CLOSED')
        THEN CURRENT_TIMESTAMP
        ELSE NULL
      END,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [caseId, targetOrderId, buyerId, sellerId, status]);
  const sellerCanOpen = sellerId !== ids.suspendedSeller;
  await client.query(`
    INSERT INTO public."CaseMessage" (
      id, "caseId", "authorId", "authorKind", body, "createdAt"
    )
    VALUES (
      $1, $2, $3, $4::public."CaseMessageAuthorKind",
      'Disposable opening evidence for the Case-message preflight proof.',
      CURRENT_TIMESTAMP
    )
  `, [
    `${caseId}-opening-message`,
    caseId,
    sellerCanOpen ? sellerId : buyerId,
    sellerCanOpen ? "SELLER" : "BUYER",
  ]);
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedUsers(client);
    await seedSellerRelationship(client, ids.seller);
    await seedSellerRelationship(client, ids.suspendedSeller);
    await seedCase(
      client,
      ids.openCase,
      "OPEN",
      ids.buyer,
      ids.seller,
    );
    await seedCase(
      client,
      ids.underReviewCase,
      "UNDER_REVIEW",
      ids.buyer,
      ids.seller,
    );
    await seedCase(
      client,
      ids.closedCase,
      "CLOSED",
      ids.buyer,
      ids.seller,
    );
    await seedCase(
      client,
      ids.missingBuyerCase,
      "IN_DISCUSSION",
      null,
      ids.seller,
    );
    await seedCase(
      client,
      ids.deletedBuyerCase,
      "IN_DISCUSSION",
      ids.deletedBuyer,
      ids.seller,
    );
    await seedCase(
      client,
      ids.suspendedSellerCase,
      "IN_DISCUSSION",
      ids.buyer,
      ids.suspendedSeller,
    );
    await seedCase(
      client,
      ids.suspendedActorCase,
      "IN_DISCUSSION",
      ids.suspendedActor,
      ids.seller,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(
      'DELETE FROM public."CaseMessage" WHERE "caseId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Case" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."OrderItem" WHERE "orderId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Order" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."Listing" WHERE id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."SellerProfile" WHERE id LIKE $1',
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

async function snapshotCaseFamily(client) {
  const result = await client.query(`
    SELECT
      COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(case_row)
          ORDER BY case_row.id
        ),
        '[]'::jsonb
      )::text AS cases,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."CaseMessage"
         WHERE "caseId" LIKE $1
      ) AS message_count
      FROM public."Case" AS case_row
     WHERE case_row.id LIKE $1
  `, [`${PREFIX}%`]);
  return result.rows[0];
}

async function proveCatalog(observer) {
  const result = await observer.query(`
    SELECT
      procedure.prosecdef AS security_definer,
      procedure.proleakproof AS leakproof,
      procedure.provolatile,
      procedure.proparallel,
      procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) = CURRENT_USER
        AS owner_is_migration_role,
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
     WHERE procedure.oid =
       'public.grainline_case_message_preflight(text,text)'::pg_catalog.regprocedure
  `);
  assert.deepEqual(result.rows[0], {
    security_definer: true,
    leakproof: false,
    provolatile: "v",
    proparallel: "u",
    proconfig: ["search_path=pg_catalog"],
    owner_is_migration_role: true,
    runtime_execute: true,
    public_execute: false,
  });
}

async function proveParticipantAndStaffAuthority(runtime) {
  const buyer = await preflight(runtime, ids.buyer, ids.openCase);
  assert.deepEqual(buyer, {
    caseId: ids.openCase,
    orderId: orderId(ids.openCase),
    buyerUserId: ids.buyer,
    sellerUserId: ids.seller,
    status: "OPEN",
    authorKind: "BUYER",
    actsAsStaff: false,
    canCreateMessage: true,
    recipientUnavailableReason: null,
  });

  const seller = await preflight(runtime, ids.seller, ids.openCase);
  assert.equal(seller?.authorKind, "SELLER");
  assert.equal(seller?.actsAsStaff, false);
  assert.equal(seller?.canCreateMessage, true);

  const staff = await preflight(runtime, ids.staff, ids.underReviewCase);
  assert.equal(staff?.authorKind, "STAFF");
  assert.equal(staff?.actsAsStaff, true);
  assert.equal(staff?.canCreateMessage, true);
  assert.equal(staff?.recipientUnavailableReason, null);

  const participantUnderReview = await preflight(
    runtime,
    ids.buyer,
    ids.underReviewCase,
  );
  assert.equal(participantUnderReview?.canCreateMessage, false);

  const staffClosed = await preflight(runtime, ids.staff, ids.closedCase);
  assert.equal(staffClosed?.canCreateMessage, false);

  assert.equal(await preflight(runtime, ids.foreign, ids.openCase), null);
  assert.equal(await preflight(runtime, ids.buyer, `${PREFIX}-missing`), null);
  assert.equal(
    await preflight(runtime, ids.suspendedActor, ids.suspendedActorCase),
    null,
  );
}

async function proveCounterpartyAvailability(runtime) {
  assert.equal(
    (
      await preflight(runtime, ids.seller, ids.missingBuyerCase)
    )?.recipientUnavailableReason,
    "missing",
  );
  assert.equal(
    (
      await preflight(runtime, ids.seller, ids.deletedBuyerCase)
    )?.recipientUnavailableReason,
    "deleted",
  );
  assert.equal(
    (
      await preflight(runtime, ids.buyer, ids.suspendedSellerCase)
    )?.recipientUnavailableReason,
    "suspended",
  );
  assert.equal(
    (
      await preflight(runtime, ids.staff, ids.suspendedSellerCase)
    )?.recipientUnavailableReason,
    null,
  );
}

async function proveTransactionLocalContext(runtime) {
  await runtime.query("BEGIN");
  try {
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await runtime.query(`
      WITH preflight AS MATERIALIZED (
        SELECT *
          FROM public.grainline_case_message_preflight($1, $2)
      )
      SELECT
        preflight."caseId",
        pg_catalog.current_setting('app.user_id', true) AS actor_context
        FROM preflight
    `, [ids.buyer, ids.openCase]);
    assert.deepEqual(result.rows[0], {
      caseId: ids.openCase,
      actor_context: ids.buyer,
    });
    await runtime.query("COMMIT");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => {});
    throw error;
  }

  const afterCommit = await runtime.query(`
    SELECT pg_catalog.current_setting(
      'app.user_id',
      true
    ) AS actor_context
  `);
  assert.ok(
    afterCommit.rows[0]?.actor_context === null
      || afterCommit.rows[0]?.actor_context === "",
    "Case-message preflight context leaked after commit",
  );
}

async function proveInvalidInput(runtime) {
  for (const params of [
    ["", ids.openCase],
    ["actor with spaces", ids.openCase],
    [ids.buyer, ""],
    [ids.buyer, "x".repeat(192)],
  ]) {
    let caught;
    try {
      await preflight(runtime, ...params);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "invalid Case-message preflight input succeeded");
    assert.match(safeError(caught), /preflight input is invalid/);
  }
}

export async function runCaseMessagePreflightAuthorityPostgresProof(
  env = process.env,
) {
  const { databaseUrl } = parseCaseMessagePreflightProofConfig(env);
  const observer = createClient(databaseUrl, "case-message-preflight-observer");
  const runtime = createClient(databaseUrl, "case-message-preflight-runtime");
  await Promise.all([observer.connect(), runtime.connect()]);
  try {
    await cleanupFixtures(observer).catch(() => {});
    await seedFixtures(observer);
    const before = await snapshotCaseFamily(observer);
    await proveCatalog(observer);
    await proveParticipantAndStaffAuthority(runtime);
    await proveCounterpartyAvailability(runtime);
    await proveTransactionLocalContext(runtime);
    await proveInvalidInput(runtime);
    const after = await snapshotCaseFamily(observer);
    assert.deepEqual(
      after,
      before,
      "Case-message preflight changed protected table state",
    );
    await cleanupFixtures(observer);
    const residue = await snapshotCaseFamily(observer);
    assert.deepEqual(residue, {
      cases: "[]",
      message_count: 0,
    });
    return Object.freeze({
      checks: 18,
      database: DATABASE_NAME,
      persistentStagingChanged: false,
      productionChanged: false,
      proofMode: "ephemeral-loopback-runtime-role-source-bound-cleanup",
      status: "passed",
    });
  } finally {
    await runtime.query("ROLLBACK").catch(() => {});
    await cleanupFixtures(observer).catch(() => {});
    await Promise.allSettled([observer.end(), runtime.end()]);
  }
}

const isMain =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCaseMessagePreflightAuthorityPostgresProof()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          message: safeError(error),
          persistentStagingChanged: false,
          productionChanged: false,
          status: "failed",
        })}\n`,
      );
      process.exitCode = 1;
    });
}
