import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function setActor(database, userId) {
  await database.query(
    `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
    [userId ?? ""],
  );
}

export async function proveSupportRequestAuthorities({ database }) {
  const suffix = `support_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const ownerId = `${suffix}_owner`;
  const otherId = `${suffix}_other`;
  const deletedOwnerId = `${suffix}_deleted_owner`;
  const staffId = `${suffix}_staff`;
  const now = new Date();
  const ownerEmail = `${suffix}@example.test`;
  const oldEmail = `${suffix}-old@example.test`;
  const reusedEmail = `${suffix.replaceAll("_", "")}@gmail.com`;
  const reusedAliasEmail = `${suffix.replaceAll("_", ".")}+support@googlemail.com`;
  const deletedConflictEmail = `${suffix}-deleted-conflict@example.test`;

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'Support owner', 'USER', false, $7, $7),
       ($4, $5, $6, 'Other owner', 'USER', false, $7, $7),
       ($8, $9, $10, 'Support staff', 'EMPLOYEE', false, $7, $7)`,
    [
      ownerId, `${ownerId}_clerk`, ownerEmail,
      otherId, `${otherId}_clerk`, reusedEmail,
      now,
      staffId, `${staffId}_clerk`, `${suffix}-staff@example.test`,
    ],
  );
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "deletedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'Deleted former owner', 'USER', false, $4, $4, $4)`,
    [deletedOwnerId, `${deletedOwnerId}_clerk`, deletedConflictEmail, now],
  );
  await database.query(
    `INSERT INTO public."UserEmailAddress"
       (id, "userId", email, source, "isCurrent", "firstSeenAt", "lastSeenAt", "currentSinceAt")
     VALUES
       ($1, $2, $3, 'proof', false, $7, $7, $7),
       ($4, $2, $5, 'proof', false, $7, $7, $7),
       ($6, $2, $8, 'proof', false, $7, $7, $7),
       ($9, $2, $10, 'proof', false, $7, $7, $7)`,
    [
      `${suffix}_address`, ownerId, oldEmail,
      `${suffix}_reused_address`, reusedEmail,
      `${suffix}_reused_alias_address`, now, reusedAliasEmail,
      `${suffix}_deleted_conflict_address`, deletedConflictEmail,
    ],
  );

  const functionRows = rowsOf(await database.query(`
    SELECT routine.proname AS name,
           routine.prosecdef AS "securityDefiner",
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
           ) AS "staffExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.proname LIKE 'grainline_support_request_%'
     ORDER BY routine.proname
  `));
  assert.deepEqual(functionRows.map((row) => row.name), [
    "grainline_support_request_account_deletion_redact_batch",
    "grainline_support_request_delivery_record",
    "grainline_support_request_overdue_count",
    "grainline_support_request_owner_export",
    "grainline_support_request_provider_deletion_upsert",
    "grainline_support_request_retention_delete_batch",
    "grainline_support_request_staff_state",
    "grainline_support_request_staff_transition",
    "grainline_support_request_submit",
  ]);
  for (const row of functionRows) {
    assert.equal(row.securityDefiner, true, row.name);
    assert.deepEqual(row.config, ["search_path=pg_catalog"], row.name);
    assert.equal(row.runtimeExecute, true, row.name);
    assert.equal(row.staffExecute, false, row.name);
    assert.equal(row.publicExecute, false, row.name);
  }

  const posture = rowsOf(await database.query(`
    SELECT class.relrowsecurity AS enabled,
           class.relforcerowsecurity AS forced,
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'SELECT') AS "runtimeSelect",
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'INSERT') AS "runtimeInsert",
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'UPDATE') AS "runtimeUpdate",
           pg_catalog.has_table_privilege('grainline_app_runtime', class.oid, 'DELETE') AS "runtimeDelete"
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."SupportRequest"'::pg_catalog.regclass
  `))[0];
  assert.deepEqual(posture, {
    enabled: true,
    forced: true,
    runtimeSelect: false,
    runtimeInsert: false,
    runtimeUpdate: false,
    runtimeDelete: false,
  }, "activation must establish policyless ENABLE/FORCE with zero direct runtime grants");

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(`SELECT id FROM public."SupportRequest" LIMIT 1`),
      /permission denied|row-level security/u,
      "runtime must not read SupportRequest directly after activation",
    );
    await setActor(database, null);
    const anonymous = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_submit(
         'support', NULL, $1, 'other', NULL, NULL,
         'Anonymous historical-email request for support.'
       )`,
      [oldEmail],
    ))[0];
    assert.equal(typeof anonymous.id, "string");
    assert.equal(typeof anonymous.emailDeliveryToken, "string");
    assert.equal(rowsOf(await database.query(
      `SELECT public.grainline_support_request_delivery_record(
         $1, pg_catalog.gen_random_uuid(), true, NULL
       ) AS applied`,
      [anonymous.id],
    ))[0].applied, false);
    assert.equal(rowsOf(await database.query(
      `SELECT public.grainline_support_request_delivery_record(
         $1, $2::uuid, true, NULL
       ) AS applied`,
      [anonymous.id, anonymous.emailDeliveryToken],
    ))[0].applied, true);
    assert.equal(rowsOf(await database.query(
      `SELECT public.grainline_support_request_delivery_record(
         $1, $2::uuid, false, 'late overwrite'
       ) AS applied`,
      [anonymous.id, anonymous.emailDeliveryToken],
    ))[0].applied, false, "delivery capability must be one-use");

    await setActor(database, `${suffix}_missing`);
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_support_request_submit(
           'support', NULL, 'forged@example.test', 'other', NULL, NULL,
           'A missing actor must not be attached to this support request.'
         )`,
      ),
      /actor context is invalid/u,
    );

    await setActor(database, ownerId);
    const linked = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_submit(
         'data_request', 'Support owner', $1, 'access', NULL, NULL,
         'Please provide a copy of all account information.'
       )`,
      [ownerEmail],
    ))[0];
    assert.equal(typeof linked.id, "string");

    await setActor(database, otherId);
    const reusedExact = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_submit(
         'data_request', 'Other owner', $1, 'access', NULL, NULL,
         'This signed-in request belongs only to the current exact-email owner.'
       )`,
      [reusedEmail],
    ))[0];
    const reusedCanonical = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_submit(
         'data_request', 'Other owner', $1, 'access', NULL, NULL,
         'This signed-in request belongs only to the current Gmail-canonical owner.'
       )`,
      [reusedAliasEmail],
    ))[0];
    const linkedForeignHistory = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_submit(
         'data_request', 'Other owner', $1, 'access', NULL, NULL,
         'This linked request stays with its stable owner despite another account history match.'
       )`,
      [oldEmail],
    ))[0];
    await setActor(database, null);
    const reusedAnonymousExact = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_submit(
         'data_request', NULL, $1, 'access', NULL, NULL,
         'This anonymous request uses an exact address now claimed by another active user.'
       )`,
      [reusedEmail],
    ))[0];
    const reusedAnonymousCanonical = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_submit(
         'data_request', NULL, $1, 'access', NULL, NULL,
         'This anonymous request uses a canonical address now claimed by another active user.'
       )`,
      [reusedAliasEmail],
    ))[0];
    const deletedConflictAnonymous = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_submit(
         'data_request', NULL, $1, 'access', NULL, NULL,
         'This anonymous request may follow history because the conflicting owner is deleted.'
       )`,
      [deletedConflictEmail],
    ))[0];

    await setActor(database, ownerId);
    const ownerExport = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_owner_export()`,
    ));
    assert.deepEqual(
      new Set(ownerExport.map((row) => row.id)),
      new Set([anonymous.id, linked.id, deletedConflictAnonymous.id]),
    );
    assert.equal(Object.hasOwn(ownerExport[0], "emailDeliveryToken"), false);

    await setActor(database, otherId);
    const otherExport = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_owner_export()`,
    ));
    assert.deepEqual(
      new Set(otherExport.map((row) => row.id)),
      new Set([
        reusedExact.id,
        reusedCanonical.id,
        linkedForeignHistory.id,
        reusedAnonymousExact.id,
      ]),
    );
    await assert.rejects(
      database.query(
        `SELECT public.grainline_support_request_staff_state(1, 50, 20) AS state`,
      ),
      /staff context is invalid/u,
    );

    await setActor(database, staffId);
    const staffState = rowsOf(await database.query(
      `SELECT public.grainline_support_request_staff_state(1, 50, 20) AS state`,
    ))[0].state;
    assert.ok(staffState.activeCount >= 1);
    assert.ok(staffState.active.some((row) => row.id === linked.id));
    assert.equal(rowsOf(await database.query(
      `SELECT public.grainline_support_request_staff_transition($1, 'CLOSED', NULL) AS result`,
      [linked.id],
    ))[0].result, "missing_closure_evidence");
    const evidence = "Account export completed and delivered under reviewed legal ticket GL-1001.";
    assert.equal(rowsOf(await database.query(
      `SELECT public.grainline_support_request_staff_transition($1, 'CLOSED', $2) AS result`,
      [linked.id, evidence],
    ))[0].result, "updated");
    assert.equal(rowsOf(await database.query(
      `SELECT public.grainline_support_request_staff_transition($1, 'OPEN', NULL) AS result`,
      [linked.id],
    ))[0].result, "closed_terminal");

    await database.query("RESET ROLE");
    const audit = rowsOf(await database.query(
      `SELECT metadata
         FROM public."AdminAuditLog"
        WHERE "targetType" = 'SUPPORT_REQUEST' AND "targetId" = $1
        ORDER BY "createdAt" DESC LIMIT 1`,
      [linked.id],
    ))[0];
    assert.equal(audit.metadata.closureEvidenceRecorded, true);
    assert.equal(JSON.stringify(audit.metadata).includes(evidence), false);

    await database.query(
      `INSERT INTO public."SupportRequest" (
         id, "userId", kind, status, email, topic, message, "slaDueAt",
         "closureEvidence", "closureEvidenceById", "createdAt", "updatedAt"
       )
       SELECT $1 || '_own_' || source.n,
              $2,
              'SUPPORT'::public."SupportRequestKind",
              'OPEN'::public."SupportRequestStatus",
              $3,
              'other',
              'Private value ' || $2 || ' must be removed from this support request.',
              $4::timestamp + INTERVAL '45 days',
              NULL,
              NULL,
              $4::timestamp,
              $4::timestamp
         FROM pg_catalog.generate_series(1, 501) AS source(n)`,
      [suffix, ownerId, ownerEmail, now],
    );
    await database.query(
      `INSERT INTO public."SupportRequest" (
         id, kind, status, email, topic, message, "slaDueAt", "closedAt",
         "closureEvidence", "closureEvidenceById", "createdAt", "updatedAt"
       )
       SELECT $1 || '_closure_' || source.n,
              'DATA_REQUEST'::public."SupportRequestKind",
              'CLOSED'::public."SupportRequestStatus",
              $2,
              'access',
              'Unrelated requester content remains.',
              $3::timestamp,
              $3::timestamp,
              'Reviewed by ' || $4 || ' with private evidence.',
              $4,
              $3::timestamp,
              $3::timestamp
         FROM pg_catalog.generate_series(1, 501) AS source(n)`,
      [suffix, `${suffix}-requester@example.test`, now, ownerId],
    );
    await database.query(
      `INSERT INTO public."SupportRequest" (
         id, kind, status, email, topic, message, "slaDueAt", "createdAt", "updatedAt"
       ) VALUES (
         $1, 'SUPPORT', 'OPEN', 'unrelated@example.test', 'other',
         'This unrelated support request must remain unchanged.', $2::timestamp, $2::timestamp, $2::timestamp
       )`,
      [`${suffix}_unrelated`, now],
    );

    await database.query("SET ROLE grainline_app_runtime");
    await setActor(database, ownerId);
    let totalRequests = 0;
    let totalClosures = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const batch = rowsOf(await database.query(
        `SELECT * FROM public.grainline_support_request_account_deletion_redact_batch(
           $1::text[], $2::text[]
         )`,
        [[ownerId, ownerEmail, oldEmail], [ownerId, ownerEmail]],
      ))[0];
      totalRequests += Number(batch.requestCount);
      totalClosures += Number(batch.closureCount);
      if (Number(batch.requestCount) < 500 && Number(batch.closureCount) < 500) break;
    }
    assert.equal(totalRequests, 504, "only the actor's linked and safe historical-email rows may be redacted");
    assert.equal(totalClosures, 501);
    const finalBatch = rowsOf(await database.query(
      `SELECT * FROM public.grainline_support_request_account_deletion_redact_batch(
         $1::text[], $2::text[]
       )`,
      [[ownerId, ownerEmail, oldEmail], [ownerId, ownerEmail]],
    ))[0];
    assert.equal(Number(finalBatch.requestCount), 0);
    assert.equal(Number(finalBatch.closureCount), 0);

    const providerFirst = rowsOf(await database.query(
      `SELECT public.grainline_support_request_provider_deletion_upsert($1) AS id`,
      ["Provider deletion remains blocked by an active marketplace obligation."],
    ))[0].id;
    const providerSecond = rowsOf(await database.query(
      `SELECT public.grainline_support_request_provider_deletion_upsert($1) AS id`,
      ["Provider deletion remains blocked; the durable request was refreshed."],
    ))[0].id;
    assert.equal(providerSecond, providerFirst);

    await database.query("RESET ROLE");
    assert.deepEqual(rowsOf(await database.query(
      `SELECT message FROM public."SupportRequest" WHERE id = $1`,
      [`${suffix}_unrelated`],
    )), [{ message: "This unrelated support request must remain unchanged." }]);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT id, "userId", email, message
         FROM public."SupportRequest"
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [[
        reusedExact.id,
        reusedCanonical.id,
        reusedAnonymousExact.id,
        reusedAnonymousCanonical.id,
        linkedForeignHistory.id,
      ]],
    )), [
      {
        id: linkedForeignHistory.id,
        userId: otherId,
        email: oldEmail,
        message: "This linked request stays with its stable owner despite another account history match.",
      },
      {
        id: reusedAnonymousCanonical.id,
        userId: null,
        email: reusedAliasEmail,
        message: "This anonymous request uses a canonical address now claimed by another active user.",
      },
      {
        id: reusedAnonymousExact.id,
        userId: null,
        email: reusedEmail,
        message: "This anonymous request uses an exact address now claimed by another active user.",
      },
      {
        id: reusedCanonical.id,
        userId: otherId,
        email: reusedAliasEmail,
        message: "This signed-in request belongs only to the current Gmail-canonical owner.",
      },
      {
        id: reusedExact.id,
        userId: otherId,
        email: reusedEmail,
        message: "This signed-in request belongs only to the current exact-email owner.",
      },
    ].sort((left, right) => left.id.localeCompare(right.id)));
    assert.deepEqual(rowsOf(await database.query(
      `SELECT "userId", email, message
         FROM public."SupportRequest"
        WHERE id = $1`,
      [deletedConflictAnonymous.id],
    )), [{
      userId: null,
      email: "deleted-account@deleted.thegrainline.local",
      message: "[Support request removed after account deletion]",
    }]);

    const oldClosedId = `${suffix}_old_closed`;
    const recentClosedId = `${suffix}_recent_closed`;
    const oldOpenId = `${suffix}_old_open`;
    await database.query(
      `INSERT INTO public."SupportRequest" (
         id, kind, status, email, topic, message, "slaDueAt", "closedAt", "createdAt", "updatedAt"
       ) VALUES
         ($1, 'SUPPORT', 'CLOSED', 'old@example.test', 'other', 'Old closed request.', $4::timestamp, $4::timestamp - INTERVAL '731 days', $4::timestamp - INTERVAL '731 days', $4::timestamp),
         ($2, 'SUPPORT', 'CLOSED', 'recent@example.test', 'other', 'Recent closed request.', $4::timestamp, $4::timestamp - INTERVAL '100 days', $4::timestamp - INTERVAL '100 days', $4::timestamp),
         ($3, 'SUPPORT', 'OPEN', 'open@example.test', 'other', 'Old open request remains active.', $4::timestamp - INTERVAL '1 day', NULL, $4::timestamp - INTERVAL '800 days', $4::timestamp)`,
      [oldClosedId, recentClosedId, oldOpenId, now],
    );
    await database.query("SET ROLE grainline_app_runtime");
    await setActor(database, null);
    assert.ok(Number(rowsOf(await database.query(
      `SELECT public.grainline_support_request_overdue_count() AS value`,
    ))[0].value) >= 1);
    assert.equal(Number(rowsOf(await database.query(
      `SELECT public.grainline_support_request_retention_delete_batch(500) AS value`,
    ))[0].value), 1);
    await database.query("RESET ROLE");
    assert.deepEqual(rowsOf(await database.query(
      `SELECT id FROM public."SupportRequest" WHERE id = ANY($1::text[]) ORDER BY id`,
      [[oldClosedId, recentClosedId, oldOpenId]],
    )).map((row) => row.id), [oldOpenId, recentClosedId].sort());
  } finally {
    await database.resetOwner();
  }
}
