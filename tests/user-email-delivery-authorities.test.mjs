import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  userEmailDeliveryRecipient,
  userEmailDeliveryRecipients,
} from "../src/lib/userEmailDeliveryAccess.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

const migrationPath =
  "prisma/migrations/20261004030000_prepare_user_email_delivery_authorities/migration.sql";
const migration = source(migrationPath);

function functionBlock(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = migration.indexOf("CREATE OR REPLACE FUNCTION public.", start + 1);
  return migration.slice(start, next < 0 ? migration.indexOf("REVOKE ALL", start) : next);
}

const functionNames = [
  "grainline_user_email_recipient",
  "grainline_user_email_recipient_batch",
  "grainline_user_email_account_state_by_id",
  "grainline_user_email_account_state_by_email",
];

describe("User email-delivery authorities", () => {
  it("defines four fixed runtime-only definer functions", () => {
    assert.equal((migration.match(/^SECURITY DEFINER$/gmu) ?? []).length, 4);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gmu) ?? []).length, 4);
    assert.equal((migration.match(/FROM PUBLIC, grainline_app_runtime/gu) ?? []).length, 4);
    assert.equal((migration.match(/TO grainline_app_runtime/gu) ?? []).length, 4);
    for (const name of functionNames) {
      const block = functionBlock(name);
      assert.match(block, /LANGUAGE plpgsql/);
      assert.match(block, /STABLE/);
      assert.match(block, /PARALLEL UNSAFE/);
      assert.doesNotMatch(block, /\bEXECUTE\b/);
      assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${name}\\(`));
      assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${name}\\(`));
    }
  });

  it("keeps SQL preference semantics aligned with the application allowlist", () => {
    const keySource = source("src/lib/notificationPreferenceKeys.ts");
    const emailBlock = keySource.match(
      /VALID_EMAIL_PREFERENCE_KEYS = \[([\s\S]*?)\] as const/u,
    )?.[1];
    assert.ok(emailBlock);
    const applicationKeys = [...emailBlock.matchAll(/"([A-Z0-9_]+)"/gu)]
      .map((match) => match[1]);
    for (const name of [
      "grainline_user_email_recipient",
      "grainline_user_email_recipient_batch",
    ]) {
      const block = functionBlock(name);
      const sqlKeys = [...block.matchAll(/'([A-Z0-9_]+)'/gu)]
        .map((match) => match[1])
        .filter((key) => key.startsWith("EMAIL_"));
      assert.deepEqual([...new Set(sqlKeys)], applicationKeys);
      assert.match(block, /p_preference_key = 'EMAIL_SELLER_BROADCAST'/);
      assert.match(block, /= 'true'::jsonb/);
      assert.match(block, /IS DISTINCT FROM 'false'::jsonb/);
    }
  });

  it("uses parameterized wrappers with strict result validation", () => {
    const access = source("src/lib/userEmailDeliveryAccess.ts");
    assert.match(access, /\$\{input\.userId\}::text/);
    assert.match(access, /\$\{input\.userIds\}::text\[\]/);
    assert.match(access, /\$\{input\.expectedEmail\}::text/);
    assert.match(access, /rows\.length !== 1/);
    assert.match(access, /recipient\.userId !== input\.userId/);
    assert.match(access, /rows\.length <= firstInputIndex\.size/);
    assert.match(access, /returnedIds\.has\(row\.userId\)/);
    assert.match(access, /inputIndex <= priorInputIndex/);
    assert.match(access, /email === email\.trim\(\)\.toLowerCase\(\)/);
    assert.match(access, /email\.indexOf\("@"\) > 0/);
    assert.match(access, /"email_changed"/);
  });

  it("rejects authority rows that violate the requested identity or batch order", async () => {
    const clientReturning = (rows) => ({
      $queryRaw: async () => rows,
    });
    const requested = {
      userIds: ["user_b", "user_a", "user_b", "user_c"],
      preferenceKey: "EMAIL_NEW_MESSAGE",
    };
    const validRows = [
      { userId: "user_b", name: "B", email: "b@example.com" },
      { userId: "user_c", name: null, email: "c@example.com" },
    ];
    assert.deepEqual(
      await userEmailDeliveryRecipients(clientReturning(validRows), requested),
      validRows,
    );
    assert.deepEqual(
      await userEmailDeliveryRecipient(clientReturning([validRows[0]]), {
        userId: "user_b",
        preferenceKey: "EMAIL_NEW_MESSAGE",
      }),
      validRows[0],
    );
    for (const rows of [
      [{ userId: "foreign", name: null, email: "foreign@example.com" }],
      [validRows[0], validRows[0]],
      [
        { userId: "user_c", name: null, email: "c@example.com" },
        { userId: "user_a", name: null, email: "a@example.com" },
      ],
      [{ userId: "user_b", name: null, email: " B@EXAMPLE.COM " }],
    ]) {
      await assert.rejects(
        userEmailDeliveryRecipients(clientReturning(rows), requested),
        /batch authority returned an invalid result/,
      );
    }
    await assert.rejects(
      userEmailDeliveryRecipient(clientReturning([validRows[0]]), {
        userId: "user_a",
        preferenceKey: "EMAIL_NEW_MESSAGE",
      }),
      /recipient authority returned an invalid result/,
    );
  });

  it("removes direct and relation-projected User email reads from converted delivery callers", () => {
    const directReport = JSON.parse(execFileSync(
      process.execPath,
      ["scripts/audit-user-direct-calls.mjs", "--json"],
      { encoding: "utf8" },
    ));
    assert.equal(directReport.count, 12);
    assert.equal(directReport.files, 7);
    assert.deepEqual(directReport.byMethod, {
      findMany: 1,
      findUnique: 9,
      update: 1,
      updateMany: 1,
    });

    for (const path of [
      "src/app/admin/verification/page.tsx",
      "src/app/api/cron/guild-member-check/route.ts",
      "src/app/api/cron/guild-metrics/route.ts",
      "src/app/api/listings/[id]/stock/route.ts",
      "src/app/api/reviews/route.ts",
      "src/app/api/cases/route.ts",
      "src/app/api/cases/[id]/messages/route.ts",
      "src/app/api/seller/broadcast/route.ts",
      "src/app/dashboard/listings/new/page.tsx",
      "src/lib/caseStaffResolutionFinalization.ts",
      "src/lib/customOrderReadyLink.ts",
      "src/lib/followerListingNotifications.ts",
      "src/lib/orderRefundFinalization.ts",
    ]) {
      const caller = source(path);
      assert.doesNotMatch(caller, /user:\s*\{\s*select:\s*\{[^}]*email:\s*true/u, path);
      assert.doesNotMatch(caller, /(?:prisma|tx)\.user\.(?:findUnique|findMany)\([\s\S]{0,300}?email:\s*true/u, path);
    }
  });

  it("checks queued address continuity before preference, suppression, and quotas", () => {
    const outbox = source("src/lib/emailOutbox.ts");
    assert.match(outbox, /expectedEmail: job\.recipientEmail/);
    assert.match(outbox, /state === "email_changed"[\s\S]*Recipient account email changed after enqueue/);
    const processStart = outbox.indexOf("async function processEmailOutboxJob(");
    const inactive = outbox.indexOf("inactiveQueuedEmailRecipientReason(job)", processStart);
    const preference = outbox.indexOf("shouldSendEmail(job.userId, job.preferenceKey)", processStart);
    const suppression = outbox.indexOf("isEmailDeliverySuppressed(job.recipientEmail)", processStart);
    const recipientQuota = outbox.indexOf("reserveRecipientDailySendAllowance", processStart);
    assert.ok(processStart >= 0 && processStart < inactive);
    assert.ok(inactive < preference && preference < suppression && suppression < recipientQuota);
  });

  it("isolates the additive migration before historical guards and restores it after signed unsubscribe", () => {
    const workflow = source(".github/workflows/ci.yml");
    const verify = workflow.indexOf("name: Verify User email-delivery authority source package");
    const isolate = workflow.indexOf("name: Isolate User email-delivery authority until historical release guards pass");
    const signedIsolate = workflow.indexOf("name: Isolate User signed-unsubscribe authority until historical release guards pass");
    const historical = workflow.indexOf("name: Verify compatible Order checkout receipt authority release");
    const signedApply = workflow.indexOf("name: Apply User signed-unsubscribe authority in disposable PostgreSQL");
    const restore = workflow.indexOf("name: Restore User email-delivery authority source package");
    const apply = workflow.indexOf("name: Apply User email-delivery authority in disposable PostgreSQL");
    const catalog = workflow.indexOf("name: Verify User email-delivery authority catalog");
    const build = workflow.indexOf("name: Production build");
    assert.ok(verify >= 0 && verify < isolate);
    assert.ok(isolate < signedIsolate && signedIsolate < historical);
    assert.ok(historical < signedApply && signedApply < restore);
    assert.ok(restore < apply && apply < catalog && catalog < build);
    assert.match(
      workflow.slice(isolate, signedIsolate),
      /prisma\/migrations\/20261004030000_prepare_user_email_delivery_authorities/,
    );
    assert.match(
      workflow.slice(restore, build),
      /--file=prisma\/migrations\/20261004030000_prepare_user_email_delivery_authorities\/migration\.sql/,
    );
    assert.match(workflow.slice(catalog, build), /pg_catalog\.count\(\*\) = 4/);
    assert.match(workflow.slice(catalog, build), /grainline_user_email_recipient_batch/);
    assert.match(workflow.slice(catalog, build), /Audit runtime grants after User email-delivery authority/);
  });
});
