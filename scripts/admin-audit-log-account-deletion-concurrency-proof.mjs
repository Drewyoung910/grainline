import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { proofServerHostAccepted } from "./disposable-postgres-proof-host.mjs";

const databaseName = "grainline_ci";
const ownerName = "ci";
const prefix = "admin-audit-race-";

export function proofConfig(env = process.env) {
  const value = env.ADMIN_AUDIT_LOG_CONCURRENCY_PROOF_DATABASE_URL;
  assert.ok(value, "ADMIN_AUDIT_LOG_CONCURRENCY_PROOF_DATABASE_URL is required");
  const url = new URL(value);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1", "proof requires numeric loopback");
  assert.equal(url.pathname, `/${databaseName}`, "proof requires its disposable database");
  assert.equal(url.username, ownerName, "proof requires its disposable owner");
  assert.equal(url.search, "", "proof rejects connection-option overrides");
  return { connectionString: value, connectionTimeoutMillis: 5_000 };
}

async function waitBlocked(observer, blockedPid, blockerPid, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      "SELECT $2::int = ANY(pg_catalog.pg_blocking_pids($1::int)) AS blocked",
      [blockedPid, blockerPid],
    );
    if (result.rows[0]?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${label} did not reach its observed database lock barrier`);
}

async function configure(client, applicationName) {
  await client.connect();
  await client.query("SELECT pg_catalog.set_config('application_name', $1, false)", [
    applicationName,
  ]);
  await client.query(`
    SET statement_timeout = '15s';
    SET lock_timeout = '12s';
    SET deadlock_timeout = '500ms'
  `);
  return Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
}

async function become(client, role) {
  await client.query(`SET SESSION AUTHORIZATION ${role}`);
}

async function beginRuntime(client, actorId) {
  await client.query("BEGIN");
  await become(client, "grainline_app_runtime");
  await client.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [actorId]);
}

async function cleanup(controller) {
  await controller.query("BEGIN");
  try {
    await controller.query(
      `DELETE FROM public."AccountDeletionSideEffect"
        WHERE id LIKE $1 OR "userId" LIKE $1 OR "dedupKey" LIKE $1`,
      [`${prefix}%`],
    );
    await controller.query(
      `DELETE FROM public."AdminAuditLog"
        WHERE id LIKE $1 OR "adminId" LIKE $1 OR "targetId" LIKE $1`,
      [`${prefix}%`],
    );
    await controller.query(`DELETE FROM public."User" WHERE id LIKE $1`, [`${prefix}%`]);
    await controller.query("COMMIT");
  } catch (error) {
    await controller.query("ROLLBACK");
    throw error;
  }
}

async function stage(label, operation) {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : "unknown error"}`, {
      cause: error,
    });
  }
}

function planIndexNames(plan, names = []) {
  if (typeof plan?.["Index Name"] === "string") names.push(plan["Index Name"]);
  for (const child of plan?.Plans ?? []) planIndexNames(child, names);
  return names;
}

async function seedUser(controller, suffix, role = "USER") {
  const id = `${prefix}${suffix}`;
  await controller.query(
    `INSERT INTO public."User" (
       id, "clerkId", email, role, banned, "updatedAt"
     ) VALUES ($1, $2, $3, $4::public."Role", false, CURRENT_TIMESTAMP)`,
    [id, `clerk-${id}`, `${suffix}@admin-audit-race.invalid`, role],
  );
  return id;
}

async function seedLocalClaim(controller, userId, suffix, claimToken) {
  const sideEffectId = `${prefix}${suffix}-local`;
  await controller.query(
    `INSERT INTO public."AccountDeletionSideEffect" (
       id, "userId", kind, "dedupKey", payload, status, attempts,
       "claimGeneration", "claimToken", "processingStartedAt",
       "createdAt", "updatedAt"
     ) VALUES (
       $1, $2::text, 'LOCAL_ANONYMIZE', 'account-delete:local:' || $2::text,
       '{}'::jsonb, 'PROCESSING', 0, 1, $3::uuid, CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [sideEffectId, userId, claimToken],
  );
  return sideEffectId;
}

async function appendSelfAudit(client, userId, auditId, rawMarker) {
  return client.query(
    `SELECT * FROM public.grainline_admin_audit_append(
       $1, 'TERMS_ACCEPTED', 'USER', $1, NULL,
       pg_catalog.jsonb_build_object('marker', $2::text, 'requestedId', $3::text)
     )`,
    [userId, rawMarker, auditId],
  );
}

async function independentWritersProof(config, controller, observer) {
  const firstUserId = await seedUser(controller, "parallel-writer-one");
  const secondUserId = await seedUser(controller, "parallel-writer-two");
  const first = new pg.Client(config);
  const second = new pg.Client(config);
  const firstPid = await configure(first, "admin-audit-race-parallel-writer-one");
  const secondPid = await configure(second, "admin-audit-race-parallel-writer-two");
  try {
    await beginRuntime(first, firstUserId);
    await appendSelfAudit(
      first,
      firstUserId,
      `${prefix}parallel-one-request`,
      "parallel-one-marker",
    );

    await beginRuntime(second, secondUserId);
    const secondAppend = await appendSelfAudit(
      second,
      secondUserId,
      `${prefix}parallel-two-request`,
      "parallel-two-marker",
    );
    assert.equal(secondAppend.rows.length, 1);
    const blockers = await observer.query(
      "SELECT pg_catalog.pg_blocking_pids($1::int) AS blockers",
      [secondPid],
    );
    assert.deepEqual(blockers.rows[0].blockers, []);
    await Promise.all([first.query("COMMIT"), second.query("COMMIT")]);
    assert.notEqual(firstPid, secondPid);
    return true;
  } finally {
    await Promise.allSettled([first.query("ROLLBACK"), second.query("ROLLBACK")]);
    await Promise.allSettled([first.end(), second.end()]);
  }
}

async function writerFirstProof(config, controller, observer) {
  const userId = await seedUser(controller, "writer-first");
  const claimToken = "81111111-1111-4111-8111-111111111111";
  const sideEffectId = await seedLocalClaim(
    controller,
    userId,
    "writer-first",
    claimToken,
  );
  const rawMarker = "writer-first-sensitive-marker";
  const writer = new pg.Client(config);
  const deletion = new pg.Client(config);
  const writerPid = await configure(writer, "admin-audit-race-writer-first");
  const deletionPid = await configure(deletion, "admin-audit-race-deletion-second");
  try {
    await beginRuntime(writer, userId);
    const append = await appendSelfAudit(writer, userId, `${prefix}unused`, rawMarker);
    assert.equal(append.rows.length, 1);
    const auditId = append.rows[0].id;

    await beginRuntime(deletion, userId);
    const pendingFence = deletion.query(
      `SELECT public.grainline_admin_audit_account_deletion_write_fence(
         $1, 1, $2::uuid
       ) AS "userId"`,
      [sideEffectId, claimToken],
    );
    await waitBlocked(observer, deletionPid, writerPid, "writer-first fence");
    await writer.query("COMMIT");
    const fence = await pendingFence;
    assert.equal(fence.rows[0].userId, userId);

    const candidates = await deletion.query(
      `SELECT * FROM public.grainline_admin_audit_account_deletion_candidates(
         $1, 1, $2::uuid, $3::text[], $3::text[], NULL, 500
       )`,
      [sideEffectId, claimToken, [userId]],
    );
    const candidate = candidates.rows.find((row) => row.id === auditId);
    assert.ok(candidate, "deletion scan missed the writer that committed before its fence");
    const plan = {
      logId: auditId,
      planVersion: 3,
      expectedMetadataSha256: candidate.metadataSha256,
      expectedReasonSha256: candidate.reasonSha256,
      metadataPatches: [
        { path: ["marker"], value: "[deleted account]" },
        { path: ["redactedForAccountDeletion"], value: true },
      ],
    };
    assert.equal(JSON.stringify(plan).includes(rawMarker), false);
    const enqueued = await deletion.query(
      `SELECT public.grainline_admin_audit_account_deletion_redaction_plans_enqueue(
         $1, 1, $2::uuid, $3::text[], $3::text[], $4::jsonb
       ) AS count`,
      [sideEffectId, claimToken, [userId], JSON.stringify([plan])],
    );
    assert.equal(enqueued.rows[0].count, 1);
    await deletion.query("COMMIT");

    const retained = await controller.query(
      `SELECT payload::text AS payload
         FROM public."AccountDeletionSideEffect"
        WHERE "dedupKey" = 'account-delete:audit:' || $1 || ':' || $2`,
      [userId, auditId],
    );
    assert.equal(retained.rows.length, 1);
    assert.equal(retained.rows[0].payload.includes(rawMarker), false);
    return true;
  } finally {
    await Promise.allSettled([writer.query("ROLLBACK"), deletion.query("ROLLBACK")]);
    await Promise.allSettled([writer.end(), deletion.end()]);
  }
}

async function deletionFirstProof(config, controller, observer) {
  const userId = await seedUser(controller, "deletion-first");
  const claimToken = "82222222-2222-4222-8222-222222222222";
  const sideEffectId = await seedLocalClaim(
    controller,
    userId,
    "deletion-first",
    claimToken,
  );
  const deletion = new pg.Client(config);
  const lateWriter = new pg.Client(config);
  const deletionPid = await configure(deletion, "admin-audit-race-deletion-first");
  const writerPid = await configure(lateWriter, "admin-audit-race-late-writer");
  try {
    await beginRuntime(deletion, userId);
    await deletion.query(
      `SELECT public.grainline_admin_audit_account_deletion_write_fence(
         $1, 1, $2::uuid
       )`,
      [sideEffectId, claimToken],
    );
    // The real path marks the User through a claimed SECURITY DEFINER
    // authority. This disposable proof uses its bootstrap owner only for the
    // fixture update, while retaining the same transaction and fence lock.
    await deletion.query("RESET SESSION AUTHORIZATION");
    await deletion.query(
      `UPDATE public."User" SET "deletedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      [userId],
    );

    await lateWriter.query("BEGIN");
    const pendingInsert = lateWriter.query(
      `INSERT INTO public."AdminAuditLog" (
         id, "adminId", action, "targetType", "targetId", metadata
       ) VALUES (
         $1, $2::text, 'TERMS_ACCEPTED', 'USER', $2::text,
         '{"marker":"late-sensitive-marker"}'::jsonb
       )`,
      [`${prefix}late-writer-audit`, userId],
    ).then((result) => ({ result }), (error) => ({ error }));
    await waitBlocked(observer, writerPid, deletionPid, "deletion-first fence");
    await deletion.query("COMMIT");
    const lateOutcome = await pendingInsert;
    assert.equal(lateOutcome.error, undefined);
    await lateWriter.query("COMMIT");
    const inserted = await controller.query(
      `SELECT "targetId", metadata
         FROM public."AdminAuditLog" WHERE id = $1`,
      [`${prefix}late-writer-audit`],
    );
    assert.deepEqual(inserted.rows, [{
      targetId: "[deleted account]",
      metadata: { marker: "late-sensitive-marker" },
    }]);
    return true;
  } finally {
    await Promise.allSettled([deletion.query("ROLLBACK"), lateWriter.query("ROLLBACK")]);
    await Promise.allSettled([deletion.end(), lateWriter.end()]);
  }
}

async function redactionAfterUndoProof(config, controller, observer) {
  const deletedUserId = await seedUser(controller, "redaction-user");
  const sourceAdminId = await seedUser(controller, "source-admin", "ADMIN");
  const undoAdminId = await seedUser(controller, "undo-admin", "ADMIN");
  const targetId = await seedUser(controller, "active-target");
  const sourceId = `${prefix}redaction-source`;
  const deletionAuditId = `${prefix}redaction-deletion-audit`;
  await controller.query(
    `INSERT INTO public."AdminAuditLog" (
       id, "adminId", action, "targetType", "targetId", metadata, reason
     ) VALUES
       ($1, $2::text, 'USER_ACCOUNT_DELETE', 'USER', $2::text,
        '{"actorKind":"user"}', NULL),
       ($3, $4, 'BAN_USER', 'USER', $5,
        pg_catalog.jsonb_build_object('subjectUserId', $2::text, 'actorKind', 'staff'),
        'reviewed source')`,
    [deletionAuditId, deletedUserId, sourceId, sourceAdminId, targetId],
  );
  await controller.query(
    `UPDATE public."User" SET "deletedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
    [deletedUserId],
  );
  const source = (await controller.query(
    `SELECT metadata, reason,
            pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(metadata::text, 'UTF8')), 'hex') AS metadata_sha,
            pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object('reason', reason)::text, 'UTF8')), 'hex') AS reason_sha
       FROM public."AdminAuditLog" WHERE id = $1`,
    [sourceId],
  )).rows[0];
  const effectId = `${prefix}redaction-effect`;
  const claimToken = "83333333-3333-4333-8333-333333333333";
  const redactedMetadata = {
    actorKind: "staff",
    subjectUserId: "[deleted account]",
    redactedForAccountDeletion: true,
  };
  await controller.query(
    `INSERT INTO public."AccountDeletionSideEffect" (
       id, "userId", kind, "dedupKey", payload, status, attempts,
       "claimGeneration", "claimToken", "processingStartedAt",
       "createdAt", "updatedAt"
     ) VALUES (
       $1, $2::text, 'AUDIT_REDACT',
       'account-delete:audit:' || $2::text || ':' || $3::text,
       $4::jsonb, 'PROCESSING', 0, 1, $5::uuid, CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    [
      effectId,
      deletedUserId,
      sourceId,
      JSON.stringify({
        logId: sourceId,
        planVersion: 3,
        expectedMetadataSha256: source.metadata_sha,
        expectedReasonSha256: source.reason_sha,
        metadataPatches: [
          { path: ["subjectUserId"], value: "[deleted account]" },
          { path: ["redactedForAccountDeletion"], value: true },
        ],
      }),
      claimToken,
    ],
  );

  const undo = new pg.Client(config);
  const redaction = new pg.Client(config);
  const undoPid = await configure(undo, "admin-audit-race-undo-first");
  const redactionPid = await configure(redaction, "admin-audit-race-redaction-second");
  try {
    await beginRuntime(undo, undoAdminId);
    const undoResult = await undo.query(
      `SELECT public.grainline_admin_audit_undo_claim(
         $1, $2, 'concurrency proof', $3, 'BAN_USER', 'USER', $4, $5::jsonb
       ) AS id`,
      [undoAdminId, sourceId, sourceAdminId, targetId, JSON.stringify(source.metadata)],
    );
    assert.equal(undoResult.rows.length, 1);

    await redaction.query("BEGIN");
    await become(redaction, "grainline_account_deletion_runtime");
    const pendingRedaction = redaction.query(
      `SELECT public.grainline_admin_audit_account_deletion_redaction_apply(
         $1, 1, $2::uuid, $3
       ) AS applied`,
      [effectId, claimToken, sourceId],
    );
    await waitBlocked(observer, redactionPid, undoPid, "undo/redaction row lock");
    await undo.query("COMMIT");
    const applied = await pendingRedaction;
    assert.equal(applied.rows[0].applied, true);
    await redaction.query("COMMIT");

    const final = (await controller.query(
      `SELECT metadata, undone, "undoneBy", "undoneReason"
         FROM public."AdminAuditLog" WHERE id=$1`,
      [sourceId],
    )).rows[0];
    assert.deepEqual(final.metadata, redactedMetadata);
    assert.equal(final.undone, true);
    assert.equal(final.undoneBy, undoAdminId);
    assert.equal(final.undoneReason, "concurrency proof");
    return true;
  } finally {
    await Promise.allSettled([undo.query("ROLLBACK"), redaction.query("ROLLBACK")]);
    await Promise.allSettled([undo.end(), redaction.end()]);
  }
}

async function competingUndoProof(config, controller, observer) {
  const sourceAdminId = await seedUser(controller, "winner-source-admin", "ADMIN");
  const actorOne = await seedUser(controller, "undo-actor-one", "ADMIN");
  const actorTwo = await seedUser(controller, "undo-actor-two", "ADMIN");
  const targetId = await seedUser(controller, "undo-target");
  const sourceId = `${prefix}undo-source`;
  const metadata = { actorKind: "staff", proof: "one winner" };
  await controller.query(
    `INSERT INTO public."AdminAuditLog" (
       id, "adminId", action, "targetType", "targetId", metadata
     ) VALUES ($1, $2, 'BAN_USER', 'USER', $3, $4::jsonb)`,
    [sourceId, sourceAdminId, targetId, JSON.stringify(metadata)],
  );
  const clients = [new pg.Client(config), new pg.Client(config)];
  try {
    const pids = await Promise.all(clients.map((client, index) => configure(
      client,
      `admin-audit-race-competing-undo-${index + 1}`,
    )));
    await Promise.all([
      beginRuntime(clients[0], actorOne),
      beginRuntime(clients[1], actorTwo),
    ]);
    const first = await clients[0].query(
      `SELECT public.grainline_admin_audit_undo_claim(
         $1, $2, $3, $4, 'BAN_USER', 'USER', $5, $6::jsonb
       ) AS id`,
      [
        actorOne,
        sourceId,
        "competing undo 1",
        sourceAdminId,
        targetId,
        JSON.stringify(metadata),
      ],
    );
    assert.equal(first.rows.length, 1);
    const pendingSecond = clients[1].query(
      `SELECT public.grainline_admin_audit_undo_claim(
         $1, $2, $3, $4, 'BAN_USER', 'USER', $5, $6::jsonb
       ) AS id`,
      [
        actorTwo,
        sourceId,
        "competing undo 2",
        sourceAdminId,
        targetId,
        JSON.stringify(metadata),
      ],
    );
    await waitBlocked(observer, pids[1], pids[0], "competing undo row lock");
    await clients[0].query("COMMIT");
    await assert.rejects(pendingSecond, (error) => error?.code === "55000");
    await clients[1].query("ROLLBACK");
    const final = await controller.query(
      `SELECT audit.undone,
              (SELECT pg_catalog.count(*)::integer
                 FROM public."AdminAuditLog" AS undo
                WHERE undo.metadata->>'originalActionId' = audit.id) AS undo_count
         FROM public."AdminAuditLog" AS audit WHERE audit.id=$1`,
      [sourceId],
    );
    assert.equal(final.rows[0].undone, true);
    assert.equal(final.rows[0].undo_count, 1);
    return true;
  } finally {
    await Promise.allSettled(clients.map((client) => client.query("ROLLBACK")));
    await Promise.allSettled(clients.map((client) => client.end()));
  }
}

async function realisticCandidatePlanProof(controller) {
  const planUserId = `${prefix}plan-user`;
  const planAdminId = `${prefix}plan-admin`;
  await controller.query("BEGIN");
  try {
    await controller.query(
      `INSERT INTO public."User" (
         id, "clerkId", email, role, banned, "updatedAt"
       ) VALUES
         ($1, 'clerk-admin-audit-plan-user', 'plan-user@admin-audit-race.invalid',
          'USER', false, CURRENT_TIMESTAMP),
         ($2, 'clerk-admin-audit-plan-admin', 'plan-admin@admin-audit-race.invalid',
          'ADMIN', false, CURRENT_TIMESTAMP)`,
      [planUserId, planAdminId],
    );
    await controller.query(
      `ALTER TABLE public."AdminAuditLog"
         DISABLE TRIGGER "AdminAuditLog_insert_write_fence"`,
    );
    await controller.query(
      `INSERT INTO public."AdminAuditLog" (
         id, "adminId", action, "targetType", "targetId", metadata,
         undone, "createdAt"
       )
       SELECT $1 || pg_catalog.lpad(series.value::text, 6, '0'),
              CASE WHEN series.value = 99998 THEN $2 ELSE $3 END,
              CASE WHEN series.value % 20 = 0 THEN 'PLAN_PROOF' ELSE 'OTHER' END,
              'OTHER',
              CASE WHEN series.value = 99999 THEN $2 ELSE 'unrelated' END,
              CASE WHEN series.value = 100000
                   THEN pg_catalog.jsonb_build_object(
                     'nested', pg_catalog.jsonb_build_object('userId', $2::text)
                   )
                   ELSE '{}'::jsonb
              END,
              false,
              CURRENT_TIMESTAMP - (series.value || ' milliseconds')::interval
         FROM pg_catalog.generate_series(1, 100000) AS series(value)`,
      [`${prefix}plan-row-`, planUserId, planAdminId],
    );
    await controller.query(`ANALYZE public."AdminAuditLog"`);
    const explained = await controller.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT audit.id::text,
              audit.metadata,
              audit.reason::text,
              pg_catalog.encode(
                pg_catalog.sha256(pg_catalog.convert_to(audit.metadata::text, 'UTF8')),
                'hex'
              ),
              pg_catalog.encode(
                pg_catalog.sha256(
                  pg_catalog.convert_to(
                    pg_catalog.jsonb_build_object('reason', audit.reason)::text,
                    'UTF8'
                  )
                ),
                'hex'
              )
         FROM public."AdminAuditLog" AS audit
        WHERE (
          audit."adminId" = $1
          OR audit."targetId" = ANY($2::text[])
          OR EXISTS (
            SELECT 1
              FROM pg_catalog.unnest($3::text[]) AS reference_value
             WHERE pg_catalog.jsonb_path_exists(
               audit.metadata,
               '$.** ? (@ == $account_reference)'::pg_catalog.jsonpath,
               pg_catalog.jsonb_build_object(
                 'account_reference', pg_catalog.to_jsonb(reference_value)
               ),
               true
             )
          )
        )
        ORDER BY audit.id ASC
        LIMIT 500`,
      [planUserId, [planUserId], [planUserId]],
    );
    const report = explained.rows[0]["QUERY PLAN"][0];
    assert.equal(report.Plan["Actual Rows"], 3);
    assert.ok(
      report["Execution Time"] < 5_000,
      `100k-row candidate plan exceeded 5s: ${report["Execution Time"]}ms`,
    );
    const unfilteredPage = (await controller.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id, action, "createdAt"
         FROM public."AdminAuditLog"
        ORDER BY "createdAt" DESC, id DESC
        LIMIT 30 OFFSET 900`,
    )).rows[0]["QUERY PLAN"][0];
    const actionPage = (await controller.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       SELECT id, action, "createdAt"
         FROM public."AdminAuditLog"
        WHERE action = 'PLAN_PROOF'
        ORDER BY "createdAt" DESC, id DESC
        LIMIT 30 OFFSET 900`,
    )).rows[0]["QUERY PLAN"][0];
    const unfilteredIndexes = planIndexNames(unfilteredPage.Plan);
    const actionIndexes = planIndexNames(actionPage.Plan);
    assert.ok(
      unfilteredIndexes.some((name) => [
        "AdminAuditLog_createdAt_id_idx",
        "AdminAuditLog_createdAt_idx",
      ].includes(name)),
      `unfiltered page used unexpected indexes: ${unfilteredIndexes.join(",")}`,
    );
    assert.ok(
      actionIndexes.includes("AdminAuditLog_action_createdAt_id_idx"),
      `action page used unexpected indexes: ${actionIndexes.join(",")}`,
    );
    assert.equal(unfilteredPage.Plan["Actual Rows"], 30);
    assert.equal(actionPage.Plan["Actual Rows"], 30);
    assert.ok(unfilteredPage["Execution Time"] < 5_000);
    assert.ok(actionPage["Execution Time"] < 5_000);
    return Object.freeze({
      candidateRows: report.Plan["Actual Rows"],
      candidateExecutionMs: report["Execution Time"],
      unfilteredPageExecutionMs: unfilteredPage["Execution Time"],
      actionPageExecutionMs: actionPage["Execution Time"],
      unfilteredPageIndex: unfilteredIndexes[0],
      actionPageIndex: "AdminAuditLog_action_createdAt_id_idx",
    });
  } finally {
    await controller.query("ROLLBACK");
    await controller.query(`ANALYZE public."AdminAuditLog"`);
  }
}

export async function runProof(config = proofConfig()) {
  const controller = new pg.Client(config);
  const observer = new pg.Client(config);
  try {
    await configure(controller, "admin-audit-race-controller");
    await configure(observer, "admin-audit-race-observer");
    const identity = (await controller.query(`
      SELECT current_database() AS db,
             current_user AS role,
             host(pg_catalog.inet_server_addr()) AS host,
             current_setting('server_version_num')::int AS version
    `)).rows[0];
    assert.equal(identity.db, databaseName);
    assert.equal(identity.role, ownerName);
    assert.equal(Math.floor(identity.version / 10_000), 17);
    assert.equal(
      // The URL is already pinned to numeric loopback. A locally published
      // Docker port reports its private bridge address from inet_server_addr.
      proofServerHostAccepted(identity.host, true),
      true,
      "proof server is not local",
    );
    await cleanup(controller);
    const result = Object.freeze({
      independentWritersConcurrent: await stage("parallel-writers", () => (
        independentWritersProof(config, controller, observer)
      )),
      writerFirstPlanned: await stage("writer-first", () => (
        writerFirstProof(config, controller, observer)
      )),
      deletionFirstRejected: await stage("deletion-first", () => (
        deletionFirstProof(config, controller, observer)
      )),
      concurrentUndoPreserved: await stage("undo-redaction", () => (
        redactionAfterUndoProof(config, controller, observer)
      )),
      competingUndoSingleWinner: await stage("competing-undo", () => (
        competingUndoProof(config, controller, observer)
      )),
      realisticCandidatePlan: await stage("candidate-plan", () => (
        realisticCandidatePlanProof(controller)
      )),
    });
    await cleanup(controller);
    return result;
  } finally {
    await Promise.allSettled([cleanup(controller)]);
    await Promise.allSettled([controller.end(), observer.end()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runProof(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `AdminAuditLog account-deletion concurrency proof failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
