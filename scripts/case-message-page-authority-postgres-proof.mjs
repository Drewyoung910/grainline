#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_MESSAGE_PAGE_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-message-page-proof";
const CREATED_AT = new Date("2026-07-29T05:40:00.000Z");

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  seller: `${PREFIX}-seller`,
  foreign: `${PREFIX}-foreign`,
  staff: `${PREFIX}-staff`,
  suspended: `${PREFIX}-suspended`,
  deleted: `${PREFIX}-deleted`,
  order: `${PREFIX}-order`,
  sellerProfile: `${PREFIX}-seller-profile`,
  listing: `${PREFIX}-listing`,
  case: `${PREFIX}-case`,
});

function messageId(position) {
  return `${PREFIX}-message-${String(position).padStart(3, "0")}`;
}

function uploadId(position) {
  return `${PREFIX}-upload-${position}`;
}

function attachmentId(position) {
  return `${PREFIX}-attachment-${position}`;
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseMessagePageProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case-message page proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case-message page proof requires the ${DATABASE_NAME} database`,
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

async function page(
  client,
  actorId,
  {
    caseId = ids.case,
    cursorCreatedAt = null,
    cursorId = null,
    limit = 51,
  } = {},
) {
  return runtimeQuery(
    client,
    `
      SELECT *
        FROM public.grainline_case_message_page(
          $1, $2, $3::timestamp, $4, $5
        )
    `,
    [actorId, caseId, cursorCreatedAt, cursorId, limit],
  );
}

async function seedUsers(client) {
  for (const [id, role, banned, deletedAt] of [
    [ids.buyer, "USER", false, null],
    [ids.seller, "USER", false, null],
    [ids.foreign, "USER", false, null],
    [ids.staff, "EMPLOYEE", false, null],
    [ids.suspended, "USER", true, null],
    [ids.deleted, "USER", false, new Date()],
  ]) {
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
      `Private ${id}`,
      role,
      banned,
      deletedAt,
    ]);
  }
}

async function seedFixtures(client) {
  await client.query("BEGIN");
  try {
    await seedUsers(client);
    await client.query(
      'INSERT INTO public."Order" (id, "buyerId") VALUES ($1, $2)',
      [ids.order, ids.buyer],
    );
    await client.query(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, 'Case-message page proof seller',
        'case-message page proof seller',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.sellerProfile, ids.seller]);
    await client.query(`
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, 'Case-message page proof listing',
        'Disposable Case-message page authority proof.',
        1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.listing, ids.sellerProfile]);
    await client.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", quantity, "priceCents"
      )
      VALUES ($1, $2, $3, 1, 1000)
    `, [`${PREFIX}-order-item`, ids.order, ids.listing]);
    await client.query(`
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description,
        status, "sellerRespondBy", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, 'OTHER',
        'Disposable Case-message page authority proof.',
        'IN_DISCUSSION', $5::timestamp + INTERVAL '48 hours',
        $5::timestamp, $5::timestamp
      )
    `, [ids.case, ids.order, ids.buyer, ids.seller, CREATED_AT]);

    for (let position = 0; position < 55; position += 1) {
      const authorId = position % 3 === 0
        ? ids.buyer
        : position % 3 === 1
          ? ids.seller
          : ids.staff;
      const authorKind = position % 3 === 0
        ? "BUYER"
        : position % 3 === 1
          ? "SELLER"
          : "STAFF";
      const createdAt = new Date(
        CREATED_AT.getTime() + Math.floor(position / 2) * 1000,
      );
      await client.query(`
        INSERT INTO public."CaseMessage" (
          id, "caseId", "authorId", "authorKind", body, "createdAt"
        )
        VALUES (
          $1, $2, $3, $4::public."CaseMessageAuthorKind", $5, $6
        )
      `, [
        messageId(position),
        ids.case,
        authorId,
        authorKind,
        `Bounded proof message ${position}.`,
        createdAt,
      ]);
    }

    for (let position = 0; position < 5; position += 1) {
      const objectKey =
        `caseEvidenceImage/clerk-${ids.buyer}/${ids.case}/proof-${position}.webp`;
      const attachmentCreatedAt =
        new Date(CREATED_AT.getTime() + 27_000 + position);
      await client.query(`
        INSERT INTO public."DirectUpload" (
          id, key, endpoint, "userId", "publicUrl", "storageClass",
          "contentType", "expectedSize", status, "verifiedAt",
          "createdAt", "updatedAt"
        )
        VALUES (
          $1, $2, 'caseEvidenceImage', $3, NULL, 'PRIVATE',
          'image/webp', 2048, 'VERIFIED', $4::timestamp,
          $4::timestamp, $4::timestamp
        )
      `, [uploadId(position), objectKey, ids.buyer, attachmentCreatedAt]);
      await client.query(`
        INSERT INTO public."CaseMessageAttachment" (
          id, "caseMessageId", "uploaderId", "objectKey", "directUploadId",
          "contentType", "byteSize", "createdAt"
        )
        VALUES (
          $1, $2, $3, $4, $5, 'image/webp', 2048, $6::timestamp
        )
      `, [
        attachmentId(position),
        messageId(54),
        ids.buyer,
        objectKey,
        uploadId(position),
        attachmentCreatedAt,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(`
      DELETE FROM public."CaseMessageAttachment"
       WHERE id LIKE $1
    `, [`${PREFIX}%`]);
    await client.query(`
      DELETE FROM public."DirectUploadReference"
       WHERE "directUploadId" LIKE $1
    `, [`${PREFIX}%`]);
    await client.query(
      'DELETE FROM public."CaseMessage" WHERE "caseId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."DirectUpload" WHERE id LIKE $1',
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
      (SELECT pg_catalog.count(*)::integer
         FROM public."Case"
        WHERE id LIKE $1) AS case_count,
      (SELECT pg_catalog.count(*)::integer
         FROM public."CaseMessage"
        WHERE "caseId" LIKE $1) AS message_count,
      (SELECT pg_catalog.count(*)::integer
         FROM public."CaseMessageAttachment"
        WHERE id LIKE $1) AS attachment_count
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
       'public.grainline_case_message_page(text,text,timestamp without time zone,text,integer)'::pg_catalog.regprocedure
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

async function proveRecipientAuthority(runtime) {
  const buyer = await page(runtime, ids.buyer, { limit: 3 });
  const seller = await page(runtime, ids.seller, { limit: 3 });
  const staff = await page(runtime, ids.staff, { limit: 3 });
  assert.equal(buyer.rowCount, 3);
  assert.deepEqual(seller.rows, buyer.rows);
  assert.deepEqual(staff.rows, buyer.rows);

  for (const actorId of [
    ids.foreign,
    ids.suspended,
    ids.deleted,
    `${PREFIX}-missing`,
  ]) {
    assert.equal((await page(runtime, actorId, { limit: 3 })).rowCount, 0);
  }
  assert.equal(
    (
      await page(runtime, ids.buyer, {
        caseId: `${PREFIX}-missing-case`,
        limit: 3,
      })
    ).rowCount,
    0,
  );
}

async function proveStableBoundedPage(runtime) {
  const maximum = await page(runtime, ids.buyer);
  assert.equal(maximum.rowCount, 51);
  const first = await page(runtime, ids.buyer, { limit: 3 });
  const cursor = first.rows.at(-1);
  const second = await page(runtime, ids.buyer, {
    cursorCreatedAt: cursor.createdAt,
    cursorId: cursor.id,
    limit: 3,
  });
  assert.equal(second.rowCount, 3);
  assert.equal(
    first.rows.some((row) => second.rows.some((next) => next.id === row.id)),
    false,
  );
  const combined = [...first.rows, ...second.rows];
  assert.deepEqual(
    combined.map((row) => row.id),
    [...combined]
      .sort((left, right) => {
        const time = right.createdAt.getTime() - left.createdAt.getTime();
        return time || right.id.localeCompare(left.id);
      })
      .map((row) => row.id),
  );
}

async function proveMinimalAttachmentProjection(runtime) {
  const rows = await page(runtime, ids.buyer, { limit: 3 });
  const newest = rows.rows.find((row) => row.id === messageId(54));
  assert.ok(newest);
  assert.deepEqual(Object.keys(newest).sort(), [
    "attachments",
    "authorId",
    "authorKind",
    "body",
    "createdAt",
    "id",
  ]);
  assert.equal(newest.authorKind, "BUYER");
  assert.equal(newest.attachments.length, 4);
  assert.deepEqual(
    Object.keys(newest.attachments[0]).sort(),
    ["byteSize", "contentType", "createdAt", "id"],
  );
  assert.deepEqual(
    newest.attachments.map((attachment) => attachment.id),
    [0, 1, 2, 3].map(attachmentId),
  );
  assert.equal(newest.attachments[0].contentType, "image/webp");
  assert.equal(newest.attachments[0].byteSize, 2048);
  assert.doesNotMatch(
    JSON.stringify(newest),
    /objectKey|directUploadId|caseEvidenceImage|example\.invalid|Private /,
  );
}

async function proveCanonicalAuthorKindProjection(runtime) {
  const rows = await page(runtime, ids.buyer, { limit: 3 });
  assert.deepEqual(
    rows.rows.map((row) => [row.id, row.authorKind]),
    [
      [messageId(54), "BUYER"],
      [messageId(53), "STAFF"],
      [messageId(52), "SELLER"],
    ],
  );
}

async function proveTransactionLocalContext(runtime) {
  await runtime.query("BEGIN");
  try {
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await runtime.query(`
      WITH history AS MATERIALIZED (
        SELECT *
          FROM public.grainline_case_message_page(
            $1, $2, NULL, NULL, 1
          )
      )
      SELECT
        history.id,
        pg_catalog.current_setting('app.user_id', true) AS actor_context
        FROM history
    `, [ids.buyer, ids.case]);
    assert.equal(result.rows[0]?.actor_context, ids.buyer);
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
    "Case-message page context leaked after commit",
  );
}

async function proveInvalidInputs(runtime) {
  for (const args of [
    ["actor with spaces", { limit: 3 }],
    [ids.buyer, { caseId: "", limit: 3 }],
    [ids.buyer, { cursorCreatedAt: CREATED_AT, limit: 3 }],
    [ids.buyer, { cursorId: messageId(1), limit: 3 }],
    [ids.buyer, { limit: 0 }],
    [ids.buyer, { limit: 52 }],
  ]) {
    let caught;
    try {
      await page(runtime, args[0], args[1]);
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "invalid Case-message page input succeeded");
    assert.match(safeError(caught), /Case-message page input is invalid/);
  }
}

export async function runCaseMessagePageAuthorityPostgresProof(
  env = process.env,
) {
  const { databaseUrl } = parseCaseMessagePageProofConfig(env);
  const observer = createClient(databaseUrl, "case-message-page-observer");
  const runtime = createClient(databaseUrl, "case-message-page-runtime");
  await Promise.all([observer.connect(), runtime.connect()]);
  try {
    await cleanupFixtures(observer).catch(() => {});
    await seedFixtures(observer);
    const before = await snapshotCaseFamily(observer);
    await proveCatalog(observer);
    await proveRecipientAuthority(runtime);
    await proveStableBoundedPage(runtime);
    await proveMinimalAttachmentProjection(runtime);
    await proveCanonicalAuthorKindProjection(runtime);
    await proveTransactionLocalContext(runtime);
    await proveInvalidInputs(runtime);
    const after = await snapshotCaseFamily(observer);
    assert.deepEqual(
      after,
      before,
      "Case-message page changed protected table state",
    );
    await cleanupFixtures(observer);
    assert.deepEqual(await snapshotCaseFamily(observer), {
      case_count: 0,
      message_count: 0,
      attachment_count: 0,
    });
    return Object.freeze({
      checks: 24,
      database: DATABASE_NAME,
      persistentStagingChanged: false,
      productionChanged: false,
      proofMode: "ephemeral-loopback-runtime-role-bounded-page-cleanup",
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
  runCaseMessagePageAuthorityPostgresProof()
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
