#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "CASE_ESCALATION_CRON_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const PREFIX = "case-escalation-cron-proof";

const ids = Object.freeze({
  buyer: `${PREFIX}-buyer`,
  seller: `${PREFIX}-seller`,
  foreign: `${PREFIX}-foreign`,
  staff: `${PREFIX}-staff`,
  sellerProfile: `${PREFIX}-seller-profile`,
  listing: `${PREFIX}-listing`,
  dueEscalation: `${PREFIX}-case-due-escalation`,
  earlyEscalation: `${PREFIX}-case-early-escalation`,
  staffEscalation: `${PREFIX}-case-staff-escalation`,
  leaseEscalation: `${PREFIX}-case-lease-escalation`,
  pendingCron: `${PREFIX}-case-pending-cron`,
  openCron: `${PREFIX}-case-open-cron`,
  staleCron: `${PREFIX}-case-stale-cron`,
  futureCron: `${PREFIX}-case-future-cron`,
  lockedCron: `${PREFIX}-case-locked-cron`,
  concurrentA: `${PREFIX}-case-concurrent-a`,
  concurrentB: `${PREFIX}-case-concurrent-b`,
  replyWins: `${PREFIX}-case-reply-wins`,
  cronWins: `${PREFIX}-case-cron-wins`,
  rollback: `${PREFIX}-case-rollback`,
});

const fixtureCases = Object.freeze([
  [ids.dueEscalation, "IN_DISCUSSION", "past"],
  [ids.earlyEscalation, "IN_DISCUSSION", "future"],
  [ids.staffEscalation, "OPEN", "future"],
  [ids.leaseEscalation, "IN_DISCUSSION", "past"],
  [ids.pendingCron, "PENDING_CLOSE", "past"],
  [ids.openCron, "OPEN", "past"],
  [ids.staleCron, "IN_DISCUSSION", "stale"],
  [ids.futureCron, "IN_DISCUSSION", "future"],
  [ids.lockedCron, "PENDING_CLOSE", "future"],
  [ids.concurrentA, "OPEN", "future"],
  [ids.concurrentB, "OPEN", "future"],
  [ids.replyWins, "PENDING_CLOSE", "future"],
  [ids.cronWins, "PENDING_CLOSE", "future"],
  [ids.rollback, "IN_DISCUSSION", "past"],
]);

function orderId(caseId) {
  return caseId.replace("-case-", "-order-");
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export function parseCaseEscalationCronProofConfig(env = process.env) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Case escalation/cron proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Case escalation/cron proof requires the ${DATABASE_NAME} database`,
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

async function expectRuntimeError(client, label, sql, params, pattern) {
  let caught;
  try {
    await runtimeQuery(client, sql, params);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.match(safeError(caught), pattern, label);
}

async function cleanupFixtures(client) {
  await client.query("BEGIN");
  try {
    await client.query(
      'DELETE FROM public."Notification" WHERE "userId" LIKE $1 OR "sourceId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."SystemAuditLog" WHERE "targetId" LIKE $1 OR id LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."AdminAuditLog" WHERE "targetId" LIKE $1 OR "adminId" LIKE $1',
      [`${PREFIX}%`],
    );
    await client.query(
      'DELETE FROM public."CaseResolutionClaim" WHERE "caseId" LIKE $1 OR "orderId" LIKE $1',
      [`${PREFIX}%`],
    );
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
      'DELETE FROM public."Listing" WHERE id = $1',
      [ids.listing],
    );
    await client.query(
      'DELETE FROM public."SellerProfile" WHERE id = $1',
      [ids.sellerProfile],
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

async function seedFixtures(client) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    )
    VALUES
      ($1, $2, $3, 'Escalation proof buyer', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Escalation proof seller', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($7, $8, $9, 'Escalation proof foreign', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($10, $11, $12, 'Escalation proof staff', 'ADMIN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.buyer,
    `clerk-${ids.buyer}`,
    `${ids.buyer}@example.invalid`,
    ids.seller,
    `clerk-${ids.seller}`,
    `${ids.seller}@example.invalid`,
    ids.foreign,
    `clerk-${ids.foreign}`,
    `${ids.foreign}@example.invalid`,
    ids.staff,
    `clerk-${ids.staff}`,
    `${ids.staff}@example.invalid`,
  ]);
  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, 'Escalation proof seller', 'escalation proof seller',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.sellerProfile, ids.seller]);
  await client.query(`
    INSERT INTO public."Listing" (
      id, "sellerId", title, description, "priceCents",
      "createdAt", "updatedAt"
    )
    VALUES (
      $1, $2, 'Escalation proof listing',
      'Disposable loopback-only escalation and cron proof.',
      10000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.listing, ids.sellerProfile]);

  for (const [position, [caseId, status, due]] of fixtureCases.entries()) {
    const targetOrderId = orderId(caseId);
    await client.query(`
      INSERT INTO public."Order" (
        id, "buyerId", "stripeChargeId", "itemsSubtotalCents",
        "shippingAmountCents", "taxAmountCents"
      )
      VALUES ($1, $2, $3, 10000, 0, 0)
    `, [
      targetOrderId,
      ids.buyer,
      `${PREFIX}-charge-${position}`,
    ]);
    await client.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", quantity, "priceCents"
      )
      VALUES ($1, $2, $3, 1, 10000)
    `, [
      `${PREFIX}-item-${position}`,
      targetOrderId,
      ids.listing,
    ]);

    const discussion =
      status === "IN_DISCUSSION"
      || status === "PENDING_CLOSE";
    const sellerRespondBy =
      status === "OPEN" && due === "past"
        ? "CURRENT_TIMESTAMP - INTERVAL '1 hour'"
        : "CURRENT_TIMESTAMP + INTERVAL '2 days'";
    const updatedAt =
      due === "stale"
        ? "CURRENT_TIMESTAMP - INTERVAL '31 days'"
        : due === "past" && status === "PENDING_CLOSE"
          ? "CURRENT_TIMESTAMP - INTERVAL '8 days'"
          : "CURRENT_TIMESTAMP";
    const escalateUnlocksAt =
      due === "past"
        ? "CURRENT_TIMESTAMP - INTERVAL '1 hour'"
        : "CURRENT_TIMESTAMP + INTERVAL '2 days'";
    await client.query(`
      INSERT INTO public."Case" (
        id, "orderId", "buyerId", "sellerId", reason, description,
        status, "sellerRespondBy", "discussionStartedAt",
        "escalateUnlocksAt", "buyerMarkedResolved",
        "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, 'OTHER',
        'Disposable escalation and cron proof Case.',
        $5::public."CaseStatus", ${sellerRespondBy},
        ${discussion ? "CURRENT_TIMESTAMP - INTERVAL '2 days'" : "NULL"},
        ${discussion ? escalateUnlocksAt : "NULL"},
        $6,
        CURRENT_TIMESTAMP - INTERVAL '40 days',
        ${updatedAt}
      )
    `, [
      caseId,
      targetOrderId,
      ids.buyer,
      ids.seller,
      status,
      status === "PENDING_CLOSE",
    ]);
  }
  await client.query(`
    UPDATE public."Order"
       SET "sellerRefundLockedAt" = CURRENT_TIMESTAMP
     WHERE id = $1
  `, [orderId(ids.leaseEscalation)]);
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
}

async function installProofRls(client) {
  const catalog = await client.query(`
    SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_policy
     WHERE polrelid = 'public."Case"'::regclass
  `);
  assert.equal(
    catalog.rows[0]?.count,
    0,
    "Case escalation/cron proof requires zero pre-activation Case policies",
  );
  await client.query(
    'ALTER TABLE public."Case" ENABLE ROW LEVEL SECURITY',
  );
  await client.query(
    'ALTER TABLE public."Case" FORCE ROW LEVEL SECURITY',
  );
}

async function removeProofRls(client) {
  await client.query(
    'ALTER TABLE public."Case" NO FORCE ROW LEVEL SECURITY',
  ).catch(() => {});
  await client.query(
    'ALTER TABLE public."Case" DISABLE ROW LEVEL SECURITY',
  ).catch(() => {});
}

async function proveCatalogAndIsolation(observer, runtime) {
  const catalog = await observer.query(`
    SELECT
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)
        AS identity_arguments,
      procedure.prosecdef,
      procedure.provolatile,
      procedure.proparallel,
      procedure.proconfig,
      owner.rolname AS owner_name,
      pg_catalog.has_function_privilege(
        'grainline_app_runtime',
        procedure.oid,
        'EXECUTE'
      ) AS runtime_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS owner
        ON owner.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'grainline_case_escalate',
         'grainline_case_cron_transition_batch'
       )
     ORDER BY procedure.proname
  `);
  assert.deepEqual(
    catalog.rows.map((row) => ({
      name: row.proname,
      args: row.identity_arguments,
      securityDefiner: row.prosecdef,
      volatility: row.provolatile,
      parallel: row.proparallel,
      config: row.proconfig,
      runtimeExecute: row.runtime_execute,
      publicExecute: row.public_execute,
    })),
    [
      {
        name: "grainline_case_cron_transition_batch",
        args: "p_transition_family text, p_limit integer",
        securityDefiner: true,
        volatility: "v",
        parallel: "u",
        config: ["search_path=pg_catalog"],
        runtimeExecute: true,
        publicExecute: false,
      },
      {
        name: "grainline_case_escalate",
        args: "p_actor_user_id text, p_case_id text",
        securityDefiner: true,
        volatility: "v",
        parallel: "u",
        config: ["search_path=pg_catalog"],
        runtimeExecute: true,
        publicExecute: false,
      },
    ],
  );
  const indexes = await observer.query(`
    SELECT
      index_class.relname AS name,
      pg_catalog.pg_get_indexdef(index_class.oid) AS definition,
      pg_catalog.pg_get_expr(
        index_catalog.indpred,
        index_catalog.indrelid
      ) AS predicate
      FROM pg_catalog.pg_index AS index_catalog
      JOIN pg_catalog.pg_class AS index_class
        ON index_class.oid = index_catalog.indexrelid
     WHERE index_catalog.indrelid = 'public."Case"'::regclass
       AND index_class.relname IN (
         'Case_pendingCloseUpdatedAtId_idx',
         'Case_openSellerRespondById_idx',
         'Case_discussionUpdatedAtId_idx'
       )
     ORDER BY index_class.relname
  `);
  assert.deepEqual(
    indexes.rows.map((row) => row.name),
    [
      "Case_discussionUpdatedAtId_idx",
      "Case_openSellerRespondById_idx",
      "Case_pendingCloseUpdatedAtId_idx",
    ],
  );
  const indexByName = new Map(
    indexes.rows.map((row) => [row.name, row]),
  );
  assert.match(
    indexByName.get("Case_pendingCloseUpdatedAtId_idx")?.definition ?? "",
    /"updatedAt", id/,
  );
  assert.match(
    indexByName.get("Case_pendingCloseUpdatedAtId_idx")?.predicate ?? "",
    /PENDING_CLOSE/,
  );
  assert.match(
    indexByName.get("Case_openSellerRespondById_idx")?.definition ?? "",
    /"sellerRespondBy", id/,
  );
  assert.match(
    indexByName.get("Case_openSellerRespondById_idx")?.predicate ?? "",
    /OPEN/,
  );
  assert.match(
    indexByName.get("Case_discussionUpdatedAtId_idx")?.definition ?? "",
    /"updatedAt", id/,
  );
  assert.match(
    indexByName.get("Case_discussionUpdatedAtId_idx")?.predicate ?? "",
    /IN_DISCUSSION/,
  );

  const direct = await runtimeQuery(
    runtime,
    `
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."Case"
       WHERE id LIKE $1
    `,
    [`${PREFIX}%`],
  );
  assert.equal(direct.rows[0]?.count, 0);
  const directUpdate = await runtimeQuery(
    runtime,
    `
      UPDATE public."Case"
         SET description = description
       WHERE id = $1
      RETURNING id
    `,
    [ids.dueEscalation],
  );
  assert.equal(directUpdate.rowCount, 0);
}

async function escalate(client, actorId, caseId) {
  const result = await runtimeQuery(
    client,
    "SELECT public.grainline_case_escalate($1, $2) AS result",
    [actorId, caseId],
  );
  return result.rows[0]?.result;
}

async function cronBatch(client, family, limit = 100) {
  const result = await runtimeQuery(
    client,
    `
      SELECT *
        FROM public.grainline_case_cron_transition_batch($1, $2)
       ORDER BY "caseId"
    `,
    [family, limit],
  );
  return result.rows;
}

async function proveInteractiveAuthority(observer, runtime) {
  await expectRuntimeError(
    runtime,
    "foreign escalation",
    "SELECT public.grainline_case_escalate($1, $2)",
    [ids.foreign, ids.dueEscalation],
    /actor is not authorized/,
  );
  await expectRuntimeError(
    runtime,
    "early participant escalation",
    "SELECT public.grainline_case_escalate($1, $2)",
    [ids.buyer, ids.earlyEscalation],
    /not yet available/,
  );
  await observer.query(
    'UPDATE public."User" SET banned = true WHERE id = $1',
    [ids.seller],
  );
  const unavailable = await escalate(
    runtime,
    ids.buyer,
    ids.earlyEscalation,
  );
  assert.equal(unavailable.action, "updated");
  assert.equal(unavailable.previousStatus, "IN_DISCUSSION");
  await observer.query(
    'UPDATE public."User" SET banned = false WHERE id = $1',
    [ids.seller],
  );
  await expectRuntimeError(
    runtime,
    "refund lease escalation",
    "SELECT public.grainline_case_escalate($1, $2)",
    [ids.buyer, ids.leaseEscalation],
    /conflicts with a refund or resolution/,
  );

  const participant = await escalate(
    runtime,
    ids.buyer,
    ids.dueEscalation,
  );
  assert.equal(participant.action, "updated");
  assert.equal(participant.actorKind, "user");
  assert.equal(participant.previousStatus, "IN_DISCUSSION");
  assert.equal(participant.status, "UNDER_REVIEW");
  const replay = await escalate(runtime, ids.buyer, ids.dueEscalation);
  assert.equal(replay.action, "replay");
  assert.equal(replay.auditLogId, participant.auditLogId);
  await observer.query(`
    UPDATE public."AdminAuditLog"
       SET metadata = metadata - 'previousStatus'
     WHERE id = $1
  `, [participant.auditLogId]);
  await expectRuntimeError(
    runtime,
    "malformed escalation replay",
    "SELECT public.grainline_case_escalate($1, $2)",
    [ids.buyer, ids.dueEscalation],
    /replay is invalid/,
  );
  await observer.query(`
    UPDATE public."AdminAuditLog"
       SET metadata = pg_catalog.jsonb_set(
         metadata,
         '{previousStatus}',
         pg_catalog.to_jsonb('IN_DISCUSSION'::text),
         true
       )
     WHERE id = $1
  `, [participant.auditLogId]);

  const staff = await escalate(runtime, ids.staff, ids.staffEscalation);
  assert.equal(staff.actorKind, "staff");
  assert.equal(staff.previousStatus, "OPEN");
  const audits = await observer.query(`
    SELECT
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."AdminAuditLog"
         WHERE id = $1
           AND "adminId" = $2
           AND action = 'ESCALATE_CASE'
      ) AS participant_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."SystemAuditLog"
         WHERE id = $3
           AND "actorType" = 'staff'
           AND "actorId" = $4
           AND action = 'ESCALATE_CASE'
      ) AS staff_count
  `, [
    participant.auditLogId,
    ids.buyer,
    staff.auditLogId,
    ids.staff,
  ]);
  assert.deepEqual(audits.rows[0], {
    participant_count: 1,
    staff_count: 1,
  });
}

async function replayAtomicNotification(
  runtime,
  row,
  userId,
) {
  await runtimeQuery(
    runtime,
    `
      SELECT public.grainline_notification_create_case_event(
        $1,
        $2,
        $3::public."NotificationType",
        'case_system_action',
        $4,
        NULL
      )
    `,
    [randomUUID(), userId, row.notificationType, row.auditLogId],
  );
}

async function proveCronFamiliesAndNotifications(observer, runtime) {
  const pending = await cronBatch(runtime, "PENDING_CLOSE_EXPIRED");
  const open = await cronBatch(runtime, "OPEN_RESPONSE_DUE");
  const stale = await cronBatch(runtime, "STALE_DISCUSSION");
  assert.deepEqual(
    pending.map((row) => row.caseId),
    [ids.pendingCron],
  );
  assert.deepEqual(open.map((row) => row.caseId), [ids.openCron]);
  assert.deepEqual(stale.map((row) => row.caseId), [ids.staleCron]);

  const rows = [...pending, ...open, ...stale];
  for (const row of rows) {
    const source = await observer.query(`
      SELECT
        audit.action,
        audit."actorType",
        audit."actorId",
        audit.metadata->>'previousStatus' AS "previousStatus",
        audit.metadata->>'newStatus' AS "newStatus",
        pg_catalog.count(notification.id)::integer AS "notificationCount"
        FROM public."SystemAuditLog" AS audit
        LEFT JOIN public."Notification" AS notification
          ON notification."sourceType" = 'case_system_action'
         AND notification."sourceId" = audit.id
       WHERE audit.id = $1
       GROUP BY audit.id
    `, [row.auditLogId]);
    assert.equal(source.rows[0]?.actorType, "cron");
    assert.equal(source.rows[0]?.actorId, "case-auto-close");
    assert.equal(source.rows[0]?.previousStatus, row.previousStatus);
    assert.equal(source.rows[0]?.newStatus, row.status);
    assert.equal(source.rows[0]?.notificationCount, 2);

    await replayAtomicNotification(runtime, row, ids.buyer);
    await replayAtomicNotification(runtime, row, ids.seller);
    const afterReplay = await observer.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."Notification"
       WHERE "sourceType" = 'case_system_action'
         AND "sourceId" = $1
    `, [row.auditLogId]);
    assert.equal(afterReplay.rows[0]?.count, 2);
  }

  const untouched = await observer.query(`
    SELECT status::text, "updatedAt" > CURRENT_TIMESTAMP - INTERVAL '1 day'
      AS recent
      FROM public."Case"
     WHERE id = $1
  `, [ids.futureCron]);
  assert.deepEqual(untouched.rows[0], {
    status: "IN_DISCUSSION",
    recent: true,
  });

  await expectRuntimeError(
    runtime,
    "unknown cron transition family",
    "SELECT * FROM public.grainline_case_cron_transition_batch($1, $2)",
    ["CALLER_SELECTED", 1],
    /input is invalid/,
  );
  await expectRuntimeError(
    runtime,
    "null cron transition family",
    "SELECT * FROM public.grainline_case_cron_transition_batch($1, $2)",
    [null, 1],
    /input is invalid/,
  );
  await expectRuntimeError(
    runtime,
    "oversized cron transition batch",
    "SELECT * FROM public.grainline_case_cron_transition_batch($1, $2)",
    ["OPEN_RESPONSE_DUE", 101],
    /input is invalid/,
  );
}

async function proveSkipLocked(observer, runtime) {
  await observer.query(`
    UPDATE public."Case"
       SET status = 'PENDING_CLOSE',
           "buyerMarkedResolved" = true,
           "updatedAt" = CURRENT_TIMESTAMP - INTERVAL '8 days'
     WHERE id = $1
  `, [ids.lockedCron]);
  await observer.query("BEGIN");
  try {
    await observer.query(
      'SELECT id FROM public."Order" WHERE id = $1 FOR UPDATE',
      [orderId(ids.lockedCron)],
    );
    const skipped = await cronBatch(runtime, "PENDING_CLOSE_EXPIRED");
    assert.equal(
      skipped.some((row) => row.caseId === ids.lockedCron),
      false,
    );
  } finally {
    await observer.query("ROLLBACK");
  }
  const transitioned = await cronBatch(runtime, "PENDING_CLOSE_EXPIRED");
  assert.equal(
    transitioned.some((row) => row.caseId === ids.lockedCron),
    true,
  );
}

async function proveConcurrentWorkers(observer, first, second) {
  await observer.query(`
    UPDATE public."Case"
       SET "sellerRespondBy" = CURRENT_TIMESTAMP - INTERVAL '1 hour'
     WHERE id IN ($1, $2)
  `, [ids.concurrentA, ids.concurrentB]);
  const [left, right] = await Promise.all([
    cronBatch(first, "OPEN_RESPONSE_DUE"),
    cronBatch(second, "OPEN_RESPONSE_DUE"),
  ]);
  const combined = [...left, ...right]
    .map((row) => row.caseId)
    .filter((caseId) => (
      caseId === ids.concurrentA
      || caseId === ids.concurrentB
    ));
  assert.deepEqual(
    [...combined].sort(),
    [ids.concurrentA, ids.concurrentB].sort(),
  );
  assert.equal(new Set(combined).size, combined.length);
  const residue = await observer.query(`
    SELECT
      case_row.id,
      pg_catalog.count(DISTINCT audit.id)::integer AS "auditCount",
      pg_catalog.count(notification.id)::integer AS "notificationCount"
      FROM public."Case" AS case_row
      LEFT JOIN public."SystemAuditLog" AS audit
        ON audit."targetId" = case_row.id
       AND audit.action = 'AUTO_ESCALATE_CASE'
      LEFT JOIN public."Notification" AS notification
        ON notification."sourceType" = 'case_system_action'
       AND notification."sourceId" = audit.id
     WHERE case_row.id IN ($1, $2)
     GROUP BY case_row.id
     ORDER BY case_row.id
  `, [ids.concurrentA, ids.concurrentB]);
  assert.deepEqual(
    residue.rows,
    [ids.concurrentA, ids.concurrentB].sort().map((caseId) => ({
      id: caseId,
      auditCount: 1,
      notificationCount: 2,
    })),
  );
}

async function proveReplyCronWinnerOrderings(observer, runtime) {
  await observer.query(`
    UPDATE public."Case"
       SET "updatedAt" = CURRENT_TIMESTAMP - INTERVAL '8 days'
     WHERE id = $1
  `, [ids.replyWins]);
  await observer.query("BEGIN");
  try {
    await observer.query(
      'SELECT id FROM public."Case" WHERE id = $1 FOR UPDATE',
      [ids.replyWins],
    );
    const skipped = await cronBatch(runtime, "PENDING_CLOSE_EXPIRED");
    assert.equal(
      skipped.some((row) => row.caseId === ids.replyWins),
      false,
    );
    await observer.query(`
      UPDATE public."Case"
         SET status = 'IN_DISCUSSION',
             "buyerMarkedResolved" = false,
             "sellerMarkedResolved" = false,
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1
    `, [ids.replyWins]);
    await observer.query("COMMIT");
  } catch (error) {
    await observer.query("ROLLBACK").catch(() => {});
    throw error;
  }
  assert.equal(
    (await cronBatch(runtime, "PENDING_CLOSE_EXPIRED"))
      .some((row) => row.caseId === ids.replyWins),
    false,
  );

  await observer.query(`
    UPDATE public."Case"
       SET "updatedAt" = CURRENT_TIMESTAMP - INTERVAL '8 days'
     WHERE id = $1
  `, [ids.cronWins]);
  const cronWins = await cronBatch(runtime, "PENDING_CLOSE_EXPIRED");
  assert.equal(
    cronWins.some((row) => row.caseId === ids.cronWins),
    true,
  );
  await expectRuntimeError(
    runtime,
    "reply after cron winner",
    `
      SELECT public.grainline_case_reply(
        $1,
        $2,
        'This reply must lose to the committed cron transition.',
        ARRAY[]::text[]
      )
    `,
    [ids.buyer, ids.cronWins],
    /Case is closed/,
  );
}

async function proveRollback(observer, runtime) {
  await runtime.query("BEGIN");
  try {
    await runtime.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await runtime.query(
      "SELECT public.grainline_case_escalate($1, $2) AS result",
      [ids.buyer, ids.rollback],
    );
    assert.equal(result.rows[0]?.result?.status, "UNDER_REVIEW");
  } finally {
    await runtime.query("ROLLBACK");
  }
  const state = await observer.query(`
    SELECT
      status::text,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."AdminAuditLog"
         WHERE "targetId" = $1
           AND action = 'ESCALATE_CASE'
      ) AS audit_count
      FROM public."Case"
     WHERE id = $1
  `, [ids.rollback]);
  assert.deepEqual(state.rows[0], {
    status: "IN_DISCUSSION",
    audit_count: 0,
  });
}

async function assertZeroResidue(client) {
  const residue = await client.query(`
    SELECT
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."Case"
         WHERE id LIKE $1
      ) AS case_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."SystemAuditLog"
         WHERE "targetId" LIKE $1
      ) AS system_audit_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."AdminAuditLog"
         WHERE "targetId" LIKE $1
      ) AS admin_audit_count,
      (
        SELECT pg_catalog.count(*)::integer
          FROM public."Notification"
         WHERE "userId" LIKE $1 OR "sourceId" LIKE $1
      ) AS notification_count
  `, [`${PREFIX}%`]);
  assert.deepEqual(residue.rows[0], {
    case_count: 0,
    system_audit_count: 0,
    admin_audit_count: 0,
    notification_count: 0,
  });
}

export async function runCaseEscalationCronAuthorityProof(
  env = process.env,
) {
  const { databaseUrl } = parseCaseEscalationCronProofConfig(env);
  const observer = createClient(
    databaseUrl,
    "case-escalation-cron-proof-observer",
  );
  const runtime = createClient(
    databaseUrl,
    "case-escalation-cron-proof-runtime",
  );
  const first = createClient(
    databaseUrl,
    "case-escalation-cron-proof-first",
  );
  const second = createClient(
    databaseUrl,
    "case-escalation-cron-proof-second",
  );
  await Promise.all([
    observer.connect(),
    runtime.connect(),
    first.connect(),
    second.connect(),
  ]);
  const checks = [];
  try {
    await removeProofRls(observer);
    await cleanupFixtures(observer).catch(() => {});
    await assertZeroResidue(observer);
    checks.push("preflight-zero-residue");
    await seedFixtures(observer);
    await installProofRls(observer);
    await proveCatalogAndIsolation(observer, runtime);
    checks.push("catalog-grants-and-forced-direct-denial");
    await proveInteractiveAuthority(observer, runtime);
    checks.push("participant-staff-replay-and-lease-authority");
    await proveCronFamiliesAndNotifications(observer, runtime);
    checks.push("three-families-atomic-audit-notification-and-replay");
    await proveSkipLocked(observer, runtime);
    checks.push("order-skip-locked");
    await proveConcurrentWorkers(observer, first, second);
    checks.push("concurrent-workers-no-duplicate-transition");
    await proveReplyCronWinnerOrderings(observer, runtime);
    checks.push("reply-cron-both-winner-orderings");
    await proveRollback(observer, runtime);
    checks.push("caller-rollback");
    await removeProofRls(observer);
    await cleanupFixtures(observer);
    await assertZeroResidue(observer);
    checks.push("cleanup-zero-residue");
    return Object.freeze({
      checks,
      database: DATABASE_NAME,
      persistentStagingChanged: false,
      productionChanged: false,
      proofMode:
        "ephemeral-loopback-runtime-role-forced-rls-concurrency-cleanup",
      status: "passed",
    });
  } finally {
    await Promise.allSettled([
      runtime.query("ROLLBACK"),
      first.query("ROLLBACK"),
      second.query("ROLLBACK"),
    ]);
    await removeProofRls(observer).catch(() => {});
    await cleanupFixtures(observer).catch(() => {});
    await Promise.allSettled([
      observer.end(),
      runtime.end(),
      first.end(),
      second.end(),
    ]);
  }
}

const isMain =
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runCaseEscalationCronAuthorityProof()
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
