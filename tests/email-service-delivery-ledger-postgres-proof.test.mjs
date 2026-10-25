import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20261025010000_prepare_email_delivery_ledger/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const baseSchema = `
  CREATE TABLE public."User" (
    id text PRIMARY KEY,
    email varchar(254) NOT NULL,
    banned boolean NOT NULL DEFAULT false,
    "deletedAt" timestamp(3) without time zone
  );

  CREATE TABLE public."EmailSuppression" (
    id text PRIMARY KEY,
    email varchar(254) NOT NULL UNIQUE,
    reason text NOT NULL,
    source varchar(100),
    "eventId" varchar(255),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE public."NewsletterSubscriber" (
    id text PRIMARY KEY,
    email varchar(254) NOT NULL UNIQUE,
    name varchar(200),
    "subscribedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    active boolean NOT NULL DEFAULT false,
    "confirmedAt" timestamp(3) without time zone,
    "confirmationTokenHash" varchar(64),
    "confirmationExpiresAt" timestamp(3) without time zone,
    "confirmationSentAt" timestamp(3) without time zone
  );

  CREATE TABLE public."ResendWebhookEvent" (
    "svixId" varchar(255) PRIMARY KEY,
    type varchar(100) NOT NULL,
    "processingStartedAt" timestamp(3) without time zone,
    "processedAt" timestamp(3) without time zone,
    "lastError" varchar(2000),
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE public."EmailOutbox" (
    id text PRIMARY KEY,
    "recipientEmail" varchar(254) NOT NULL,
    "userId" varchar(191),
    "preferenceKey" varchar(80),
    "templateName" varchar(80) NOT NULL DEFAULT 'unknown',
    "templateVersion" integer NOT NULL DEFAULT 1,
    "sourceType" varchar(80),
    "sourceId" varchar(191),
    subject varchar(300) NOT NULL,
    html text NOT NULL,
    "dedupKey" varchar(128) NOT NULL UNIQUE,
    status varchar(20) NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    "nextAttemptAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP,
    "sentAt" timestamp(3) without time zone,
    "lastError" varchar(1000),
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailOutbox_status_chk"
      CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','SKIPPED','DEAD'))
  );

  CREATE OR REPLACE FUNCTION public.grainline_user_email_account_state_by_id(
    p_user_id text,
    p_expected_email text
  ) RETURNS text
  LANGUAGE sql STABLE
  AS $$
    SELECT CASE
      WHEN source_user.id IS NULL THEN 'missing'
      WHEN source_user.banned THEN 'banned'
      WHEN source_user."deletedAt" IS NOT NULL THEN 'deleted'
      WHEN source_user.email <> p_expected_email THEN 'email_changed'
      ELSE 'active'
    END
    FROM (SELECT 1) seed
    LEFT JOIN public."User" source_user ON source_user.id = p_user_id
  $$;

  CREATE OR REPLACE FUNCTION public.grainline_user_email_account_state_by_email(
    p_email text
  ) RETURNS text
  LANGUAGE sql STABLE
  AS $$
    SELECT CASE
      WHEN COALESCE(pg_catalog.bool_or(source_user.banned), false) THEN 'banned'
      WHEN COALESCE(pg_catalog.bool_or(source_user."deletedAt" IS NOT NULL), false) THEN 'deleted'
      ELSE 'active'
    END
    FROM public."User" source_user
    WHERE source_user.email = p_email
  $$;

  CREATE OR REPLACE FUNCTION public.grainline_user_email_recipient(
    p_user_id text,
    p_preference_key text
  ) RETURNS TABLE ("userId" text, name text, email text)
  LANGUAGE sql STABLE
  AS $$
    SELECT source_user.id, NULL::text, source_user.email
      FROM public."User" source_user
     WHERE source_user.id = p_user_id
       AND source_user.banned = false
       AND source_user."deletedAt" IS NULL
       AND p_preference_key NOT IN ('DISABLED_TEST', 'EMAIL_REFUND_ISSUED')
  $$;
`;

async function createDatabase() {
  const database = new PGlite();
  await database.exec(baseSchema);
  await database.exec(migration);
  return database;
}

function insertLegacyJob({
  id,
  templateName = "welcome",
  recipientEmail = `${id}@example.test`,
  userId = null,
  preferenceKey = null,
  status = "PENDING",
  attempts = 0,
  createdAt = "2026-10-25 00:00:00",
  updatedAt = createdAt,
  nextAttemptAt = "2026-10-25 00:00:00",
  firstProviderAttemptAt = null,
}) {
  return {
    text: `
      INSERT INTO public."EmailOutbox" (
        id, "recipientEmail", "userId", "preferenceKey", "templateName",
        "templateVersion", subject, html, "dedupKey", status, attempts,
        "nextAttemptAt", "firstProviderAttemptAt", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, 1, 'subject', '<p>body</p>', $6, $7, $8,
        $9::timestamp, $10::timestamp, $11::timestamp, $12::timestamp
      )
    `,
    params: [
      id,
      recipientEmail,
      userId,
      preferenceKey,
      templateName,
      `dedup-${id}`,
      status,
      attempts,
      nextAttemptAt,
      firstProviderAttemptAt,
      createdAt,
      updatedAt,
    ],
  };
}

test("email delivery preparation fences claims and prioritizes transactional jobs", async () => {
  const database = await createDatabase();
  try {
    await database.query("INSERT INTO public.\"User\" (id,email) VALUES ($1,$2)", [
      "user-1",
      "buyer@example.test",
    ]);
    await database.query(...Object.values(insertLegacyJob({
      id: "optional-old",
      templateName: "seller_broadcast",
      createdAt: "2026-10-24 20:00:00",
    })));
    await database.query(...Object.values(insertLegacyJob({
      id: "transactional-new",
      templateName: "refund_issued",
      recipientEmail: "buyer@example.test",
      userId: "user-1",
      preferenceKey: "EMAIL_REFUND_ISSUED",
      createdAt: "2026-10-24 21:00:00",
    })));

    const first = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_batch(1)",
    );
    assert.equal(first.rows.length, 1);
    assert.equal(first.rows[0].jobId, "transactional-new");
    assert.equal(first.rows[0].lane, "TRANSACTIONAL");
    assert.equal(Number(first.rows[0].claimGeneration), 1);
    assert.match(first.rows[0].claimToken, /^[a-f0-9-]{36}$/u);

    await database.query(
      `UPDATE public."EmailOutbox"
          SET "processingStartedAt" = now() - interval '20 minutes'
        WHERE id = 'transactional-new'`,
    );
    const reclaimed = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one('transactional-new')",
    );
    assert.equal(Number(reclaimed.rows[0].claimGeneration), 2);
    assert.notEqual(reclaimed.rows[0].claimToken, first.rows[0].claimToken);

    const staleCompletion = await database.query(
      "SELECT public.grainline_email_outbox_complete($1,$2,$3::uuid,$4) AS result",
      ["transactional-new", 1, first.rows[0].claimToken, "provider-old"],
    );
    assert.equal(staleCompletion.rows[0].result, "stale_claim");

    const providerReady = await database.query(
      "SELECT public.grainline_email_outbox_begin_provider_attempt($1,$2,$3::uuid) AS result",
      ["transactional-new", 2, reclaimed.rows[0].claimToken],
    );
    assert.equal(providerReady.rows[0].result, "ready");

    const completed = await database.query(
      "SELECT public.grainline_email_outbox_complete($1,$2,$3::uuid,$4) AS result",
      ["transactional-new", 2, reclaimed.rows[0].claimToken, "provider-current"],
    );
    assert.equal(completed.rows[0].result, "applied");
    const row = await database.query(
      'SELECT status, "providerMessageId", "claimToken" FROM public."EmailOutbox" WHERE id=$1',
      ["transactional-new"],
    );
    assert.deepEqual(row.rows[0], {
      status: "SENT",
      providerMessageId: "provider-current",
      claimToken: null,
    });
  } finally {
    await database.close();
  }
});

test("email delivery preparation stops capped and expired automatic retries", async () => {
  const database = await createDatabase();
  try {
    await database.query(...Object.values(insertLegacyJob({
      id: "attempt-cap",
      status: "PROCESSING",
      attempts: 10,
      nextAttemptAt: null,
      updatedAt: "2026-10-24 00:00:00",
    })));
    await database.query(...Object.values(insertLegacyJob({
      id: "expired-provider-window",
      status: "FAILED",
      attempts: 1,
      firstProviderAttemptAt: "2026-10-23 00:00:00",
    })));

    const result = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_batch(10)",
    );
    assert.equal(result.rows.length, 0);
    const rows = await database.query(
      'SELECT id,status,"nextAttemptAt","claimToken","lastError" FROM public."EmailOutbox" ORDER BY id',
    );
    assert.equal(rows.rows.length, 2);
    for (const row of rows.rows) {
      assert.equal(row.status, "DEAD");
      assert.equal(row.nextAttemptAt, null);
      assert.equal(row.claimToken, null);
      assert.match(row.lastError, /manual review required/iu);
    }
  } finally {
    await database.close();
  }
});

test("email delivery preparation skips ineligible recipients before exposing a body", async () => {
  const database = await createDatabase();
  try {
    await database.query(...Object.values(insertLegacyJob({ id: "suppressed" })));
    await database.query(...Object.values(insertLegacyJob({
      id: "gmail-suppressed",
      recipientEmail: "hard.suppressed+shop@googlemail.com",
    })));
    await database.query(...Object.values(insertLegacyJob({
      id: "one-click-not-hard",
      templateName: "refund_issued",
      recipientEmail: "optional-unsubscribe@example.test",
    })));
    await database.query(...Object.values(insertLegacyJob({
      id: "anonymous-recipient",
      recipientEmail: "no-account@example.test",
    })));
    await database.query(
      "INSERT INTO public.\"User\" (id,email) VALUES ($1,$2)",
      ["transactional-user", "transactional@example.test"],
    );
    await database.query(...Object.values(insertLegacyJob({
      id: "transactional-always-on",
      templateName: "refund_issued",
      recipientEmail: "transactional@example.test",
      userId: "transactional-user",
      preferenceKey: "EMAIL_REFUND_ISSUED",
    })));
    await database.query(
      `INSERT INTO public."EmailSuppression"
        (id,email,reason,source,details,"createdAt","updatedAt")
       VALUES
         ('suppression-1','suppressed@example.test','BOUNCE','test','{}',now(),now()),
         ('suppression-2','hardsuppressed@gmail.com','COMPLAINT','test','{}',now(),now()),
         ('suppression-3','optional-unsubscribe@example.test','MANUAL','one_click_unsubscribe','{}',now(),now())`,
    );
    const exactSuppressed = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one('suppressed')",
    );
    assert.equal(exactSuppressed.rows.length, 0);
    const gmailSuppressed = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one('gmail-suppressed')",
    );
    assert.equal(gmailSuppressed.rows.length, 0);
    const state = await database.query(
      'SELECT id,status,"sentAt","lastError" FROM public."EmailOutbox" WHERE id IN ($1,$2) ORDER BY id',
      ["gmail-suppressed", "suppressed"],
    );
    assert.equal(state.rows.length, 2);
    for (const row of state.rows) {
      assert.equal(row.status, "SKIPPED");
      assert.ok(row.sentAt);
      assert.match(row.lastError, /hard-suppressed/iu);
    }

    const oneClick = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one('one-click-not-hard')",
    );
    assert.equal(oneClick.rows.length, 1);
    const anonymous = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one('anonymous-recipient')",
    );
    assert.equal(anonymous.rows.length, 1);
    const transactional = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one('transactional-always-on')",
    );
    assert.equal(transactional.rows.length, 1);
  } finally {
    await database.close();
  }
});

test("email delivery preparation orders provider attempts before completion and defers only unsent claims", async () => {
  const database = await createDatabase();
  try {
    await database.query(...Object.values(insertLegacyJob({
      id: "optional-defer",
      templateName: "seller_broadcast",
    })));
    const optionalClaim = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one('optional-defer')",
    );
    const prematureComplete = await database.query(
      "SELECT public.grainline_email_outbox_complete($1,$2,$3::uuid,$4) AS result",
      [
        "optional-defer",
        optionalClaim.rows[0].claimGeneration,
        optionalClaim.rows[0].claimToken,
        "provider-before-begin",
      ],
    );
    assert.equal(prematureComplete.rows[0].result, "stale_claim");
    const deferred = await database.query(
      "SELECT public.grainline_email_outbox_defer($1,$2,$3::uuid,$4) AS result",
      [
        "optional-defer",
        optionalClaim.rows[0].claimGeneration,
        optionalClaim.rows[0].claimToken,
        "recipient_optional_quota",
      ],
    );
    assert.equal(deferred.rows[0].result, "applied");
    const deferredState = await database.query(
      'SELECT status,attempts,"claimToken","processingStartedAt","firstProviderAttemptAt" FROM public."EmailOutbox" WHERE id=$1',
      ["optional-defer"],
    );
    assert.deepEqual(deferredState.rows[0], {
      status: "PENDING",
      attempts: 0,
      claimToken: null,
      processingStartedAt: null,
      firstProviderAttemptAt: null,
    });

    await database.query(...Object.values(insertLegacyJob({
      id: "transactional-no-optional-quota",
      templateName: "refund_issued",
    })));
    const transactionalClaim = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one('transactional-no-optional-quota')",
    );
    const refusedOptionalDeferral = await database.query(
      "SELECT public.grainline_email_outbox_defer($1,$2,$3::uuid,$4) AS result",
      [
        "transactional-no-optional-quota",
        transactionalClaim.rows[0].claimGeneration,
        transactionalClaim.rows[0].claimToken,
        "optional_global_quota",
      ],
    );
    assert.equal(refusedOptionalDeferral.rows[0].result, "stale_claim");
    const providerReady = await database.query(
      "SELECT public.grainline_email_outbox_begin_provider_attempt($1,$2,$3::uuid) AS result",
      [
        "transactional-no-optional-quota",
        transactionalClaim.rows[0].claimGeneration,
        transactionalClaim.rows[0].claimToken,
      ],
    );
    assert.equal(providerReady.rows[0].result, "ready");
    const refusedPostAttemptDeferral = await database.query(
      "SELECT public.grainline_email_outbox_defer($1,$2,$3::uuid,$4) AS result",
      [
        "transactional-no-optional-quota",
        transactionalClaim.rows[0].claimGeneration,
        transactionalClaim.rows[0].claimToken,
        "provider_unavailable",
      ],
    );
    assert.equal(refusedPostAttemptDeferral.rows[0].result, "stale_claim");
  } finally {
    await database.close();
  }
});

test("email delivery preparation constrains shapes and sanitizes stored errors", async () => {
  const database = await createDatabase();
  try {
    await database.query(...Object.values(insertLegacyJob({ id: "failure" })));
    const claim = await database.query(
      "SELECT * FROM public.grainline_email_outbox_claim_one('failure')",
    );
    const failed = await database.query(
      "SELECT public.grainline_email_outbox_fail($1,$2,$3::uuid,$4,$5) AS result",
      [
        "failure",
        claim.rows[0].claimGeneration,
        claim.rows[0].claimToken,
        "provider_retryable",
        "provider said buyer@example.test\\ntry later",
      ],
    );
    assert.equal(failed.rows[0].result, "applied");
    const state = await database.query(
      'SELECT status,"nextAttemptAt","lastError" FROM public."EmailOutbox" WHERE id=$1',
      ["failure"],
    );
    assert.equal(state.rows[0].status, "FAILED");
    assert.ok(state.rows[0].nextAttemptAt);
    assert.equal(state.rows[0].lastError.includes("buyer@example.test"), false);
    assert.equal(/[\r\n]/u.test(state.rows[0].lastError), false);

    await assert.rejects(
      database.query(
        `INSERT INTO public."EmailOutbox" (
          id,"recipientEmail","templateName","templateVersion","sourceType",
          subject,html,"dedupKey",status,attempts,"nextAttemptAt","createdAt","updatedAt"
        ) VALUES ('bad-source','bad@example.test','welcome',1,'user','s','h',
          'bad-source','PENDING',0,now(),now(),now())`,
      ),
      /EmailOutbox_source_pair_chk/u,
    );
  } finally {
    await database.close();
  }
});

test("email delivery preparation backfills newsletter deactivation and receipt fencing columns", async () => {
  const database = new PGlite();
  try {
    await database.exec(baseSchema);
    await database.exec(`
      INSERT INTO public."NewsletterSubscriber" (
        id,email,"subscribedAt",active,"confirmedAt","confirmationTokenHash",
        "confirmationExpiresAt","confirmationSentAt"
      ) VALUES (
        'inactive','inactive@example.test','2026-09-01',false,'2026-09-02',NULL,NULL,NULL
      );
    `);
    await database.exec(migration);
    const subscriber = await database.query(
      'SELECT "deactivatedAt" FROM public."NewsletterSubscriber" WHERE id=$1',
      ["inactive"],
    );
    assert.ok(subscriber.rows[0].deactivatedAt);
    const columns = await database.query(`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema='public'
         AND table_name='ResendWebhookEvent'
       ORDER BY column_name
    `);
    const names = new Set(columns.rows.map((row) => row.column_name));
    for (const name of [
      "claimGeneration",
      "claimToken",
      "attempts",
      "nextAttemptAt",
      "acknowledgedAt",
      "acknowledgedById",
      "acknowledgement",
    ]) {
      assert.equal(names.has(name), true, name);
    }
  } finally {
    await database.close();
  }
});
