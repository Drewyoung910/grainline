#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_ID = /^[a-z0-9_]+$/u;

function fixedFunctionContract(
  sourceSha256,
  result,
  { language = "plpgsql", volatility = "v" } = {},
) {
  return Object.freeze({
    sourceSha256,
    language,
    result,
    volatility,
    strict: false,
    leakproof: false,
    parallelSafety: "u",
    kind: "f",
  });
}

export const PRIVILEGE_RELEASES = Object.freeze({
  email_service_v1: Object.freeze({
    migration: "20261101090000_activate_email_service_least_privilege",
    migrationSha256:
      "380bb991461b9ff11d9b721615baafbc3d0d0d0dcc51f913381ab6d85cd3b564",
    preparationMigration: Object.freeze({
      name: "20261101080000_prepare_email_service_least_privilege",
      sha256:
        "1d231bf5df2652765a2f0c48509bc232d9976dc2a2a775a93900fe606616537a",
    }),
    compatibleDeployment: Object.freeze({
      minimumAppCommit: "e4d35863b22a1694d96f9582732ff66e26ba770d",
    }),
    rollback: Object.freeze({
      path: "docs/rls-drafts/email-service-least-privilege-activation-rollback.sql",
      sha256:
        "ebbf43d329f5e3ae6fa49b30473bc6039a0e18cf93e15fd86b34993addb4f481",
    }),
    sourceTests: Object.freeze([
      "tests/email-service-least-privilege-activation.test.mjs",
    ]),
    tables: Object.freeze({
      EmailFailureCount: Object.freeze([]),
      EmailOutbox: Object.freeze([]),
      EmailSuppression: Object.freeze([]),
      NewsletterSubscriber: Object.freeze([]),
      ResendWebhookEvent: Object.freeze([]),
    }),
    emptyTables: Object.freeze(["EmailFailureCount"]),
    functionNamespacePrefixes: Object.freeze([
      "grainline_email_",
      "grainline_newsletter_",
      "grainline_resend_",
    ]),
    functions: Object.freeze({
      "public.grainline_email_account_deletion_suppression_clear(text)": fixedFunctionContract("6f5898c1b30fdc1e11deae0ef2320b1912bfb9d602187616ccbf062aee59ccfa", "integer"),
      "public.grainline_email_hard_suppression_apply(text,text,\"EmailSuppressionReason\",text,text,jsonb)": fixedFunctionContract("26b56879c36244c42a16eeae66f06813d1c5d53fad5b0eb59a71410910dc942b", "TABLE(email text, reason \"EmailSuppressionReason\", source text, \"eventId\" text, details jsonb)"),
      "public.grainline_email_one_click_suppression_clear(text)": fixedFunctionContract("c149130950709ea50e05c69533ec63f7e27a2c3bb966dfa4e562c7aebc4d5b1f", "integer"),
      "public.grainline_email_outbox_account_deletion_fence(text,text[])": fixedFunctionContract("d6ee02f559fec2fd3e2dbf9c9925dcfecf6988e97b8c7595895585b25851eb8e", "integer"),
      "public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)": fixedFunctionContract("ccd76d8732ce145f25e523daf5f5134231e148689d7af90719c3f0680e69b708", "text"),
      "public.grainline_email_outbox_cancel_seller_broadcast(text)": fixedFunctionContract("8c0fc3a6975c1d4735741ae58062b4e55b3674ff2b898bbd17f2f951285a7f63", "integer"),
      "public.grainline_email_outbox_claim_batch(integer)": fixedFunctionContract("821da02132dba680a82444eae5bd2fb1a3690309996cc222a0a10234b199bd22", "TABLE(\"jobId\" text, \"claimGeneration\" bigint, \"claimToken\" uuid, \"recipientEmail\" text, \"recipientUserId\" text, \"preferenceKey\" text, \"templateName\" text, \"templateVersion\" integer, \"payloadVersion\" integer, payload jsonb, \"dedupKey\" text, \"createdAt\" timestamp with time zone, \"legacySubject\" text, \"legacyHtml\" text, lane text)", { language: "sql" }),
      "public.grainline_email_outbox_claim_one(text)": fixedFunctionContract("76d1a2048afa03dce1d4399df5da6abf0fb7d4f555498efe56c22712dce5beb2", "TABLE(\"jobId\" text, \"claimGeneration\" bigint, \"claimToken\" uuid, \"recipientEmail\" text, \"recipientUserId\" text, \"preferenceKey\" text, \"templateName\" text, \"templateVersion\" integer, \"payloadVersion\" integer, payload jsonb, \"dedupKey\" text, \"createdAt\" timestamp with time zone, \"legacySubject\" text, \"legacyHtml\" text, lane text)", { language: "sql" }),
      "public.grainline_email_outbox_complete(text,bigint,uuid,text)": fixedFunctionContract("45005ed25acc47482377c346493798a1109ab882554b206a3e87cb46d01def99", "text"),
      "public.grainline_email_outbox_defer(text,bigint,uuid,text)": fixedFunctionContract("3577fd4fe7462d1d33b624f5eeeec85f5e58e62d21520c99185bb6741c147653", "text"),
      "public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)": fixedFunctionContract("7ad90a7a87fe6bbae4d846f0dba88576906eb1728f35349fc0d547cf144e8d1e", "TABLE(\"jobId\" text, created boolean, outcome text)"),
      "public.grainline_email_outbox_fail(text,bigint,uuid,text,text)": fixedFunctionContract("26e4c8ffa873f11a5cd0cd19a13aa9981e32c43b9112c8bfe1af597002e97004", "text"),
      "public.grainline_email_outbox_redact_deleted_seller(text)": fixedFunctionContract("5faf7bb6b18ef373269452c7db1cea29d00ac1246510438636393d4d59ad1863", "integer"),
      "public.grainline_email_outbox_retention_delete_batch(timestamp without time zone,timestamp without time zone,integer)": fixedFunctionContract("468cb771e6840700dcfdddecbcde5b1501316858d689b94a049ee8c7c864ceb6", "integer"),
      "public.grainline_email_outbox_skip(text,bigint,uuid,text)": fixedFunctionContract("a9f62d9109e27f2b57d371d0acb24ad5854f67f00c24558421ba39e67641290e", "text"),
      "public.grainline_email_service_account_deletion_apply()": fixedFunctionContract("5d4122280abaf8953260c484184605ee67341dc2f2d65ac44d7af85671caf6ac", "jsonb"),
      "public.grainline_email_service_ops_health(timestamp without time zone,timestamp without time zone)": fixedFunctionContract("78cc50d4b586d3af14b98cf84a9daeaf1ab24b7688c87afa3b259d692a68c3fc", "TABLE(\"staleEmailCount\" integer, \"deadEmailCount\" integer, \"stalledResendCount\" integer)", { volatility: "s" }),
      "public.grainline_email_service_owner_export()": fixedFunctionContract("397fccdecada9f9d69e0fcd2dc2ff53b3c57c48fff72c159c9e4c7a83f0d6ae8", "jsonb", { volatility: "s" }),
      "public.grainline_email_suppression_exists(text,text)": fixedFunctionContract("ee3bc75727f7270fe8bcaf2f5b8643900eb28f241745423784a4bcccfa785720", "boolean", { volatility: "s" }),
      "public.grainline_email_unsubscribe_apply(text,jsonb)": fixedFunctionContract("15000f8b25f00aae839203136f89c12dabdbb9a95fae505b3d087c6182373e60", "integer"),
      "public.grainline_newsletter_confirm(text,timestamp without time zone)": fixedFunctionContract("6b963b1a927edab5b206c43c38a5a21cb025a8f6b01df700152ef40f6d129bbe", "boolean"),
      "public.grainline_newsletter_confirmation_valid(text,timestamp without time zone)": fixedFunctionContract("524a0d7765a1e839b7926e85d87da735f5aa40ca19a0bc08f64e65fab9094a25", "boolean", { language: "sql", volatility: "s" }),
      "public.grainline_newsletter_expired_unconfirmed_delete_batch(timestamp without time zone,integer)": fixedFunctionContract("92a323901d50e1bad2fa54168ccea655de3a051a040e925c95a4dc2bb55046fb", "integer"),
      "public.grainline_newsletter_signup_release(text,text)": fixedFunctionContract("1cf3d848c9c3c7b5f4dee5f8e2323de97aa9d20a474e404e0002e111016136e4", "integer"),
      "public.grainline_newsletter_signup_reserve(text,text,text,timestamp without time zone,timestamp without time zone,timestamp without time zone)": fixedFunctionContract("bf00f56a9e43fc9e7a932af7677743ac090af0c9f0ca465425816ce23fd7b404", "text"),
      "public.grainline_newsletter_token_superseded(text,timestamp without time zone)": fixedFunctionContract("c8f7e151ec4c479d430693f9450906d9e54aacf0b57b83a358c626a2f99f30c8", "boolean", { volatility: "s" }),
      "public.grainline_resend_webhook_event_complete(text,bigint,uuid,timestamp without time zone)": fixedFunctionContract("cf83773b769a3383253536cd64234cb41531bf6dca81bc646e97af4c6d72bdfd", "boolean"),
      "public.grainline_resend_webhook_event_fail(text,bigint,uuid,text,timestamp without time zone)": fixedFunctionContract("688957102e0d875e0660b178fd6d0d0f111c5c9d5a42f87b0daf8f32dc6219bd", "boolean"),
      "public.grainline_resend_webhook_event_reserve(text,text,timestamp without time zone,timestamp without time zone,uuid)": fixedFunctionContract("5db829b64af5a9749204ce9aafdcee27c1a8026e2caa7a8c9a7130fbb9715dd0", "jsonb"),
      "public.grainline_resend_webhook_event_retention_delete_batch(timestamp without time zone,integer)": fixedFunctionContract("8877e5067e8e3434f909f43c9bfeed250899f0de0f02da66c59def4f4ca81b9f", "integer"),
    }),
  }),
  service_reference_v1: Object.freeze({
    migration: "20261101020000_narrow_service_reference_runtime_privileges",
    migrationSha256:
      "5ae6d88826690ae5f0a653c02c87ae28fc76bb9f3609119402b2590594edbc6c",
    sourceTests: Object.freeze([
      "tests/service-reference-least-privilege.test.mjs",
    ]),
    tables: Object.freeze({
      FoundingMakerGrant: Object.freeze(["SELECT"]),
      Metro: Object.freeze(["INSERT", "SELECT", "UPDATE"]),
      SiteConfig: Object.freeze(["SELECT"]),
      SiteMetricsSnapshot: Object.freeze(["INSERT", "SELECT", "UPDATE"]),
      SystemAuditLog: Object.freeze(["INSERT", "SELECT"]),
    }),
  }),
});

function stopped(message) {
  return new Error(`privilege release stopped: ${message}`);
}

export function privilegeRelease(releaseId) {
  if (typeof releaseId !== "string" || !RELEASE_ID.test(releaseId)) {
    throw stopped("release id is invalid");
  }
  const release = PRIVILEGE_RELEASES[releaseId];
  if (!release) throw stopped("release id is not reviewed");
  return release;
}

export function privilegeReleaseMigrationPath(release, rootDir = process.cwd()) {
  return join(rootDir, "prisma", "migrations", release.migration, "migration.sql");
}

export function verifyPrivilegeReleaseSource(
  releaseId,
  rootDir = process.cwd(),
  migrationPath,
) {
  const release = privilegeRelease(releaseId);
  const path = migrationPath ?? privilegeReleaseMigrationPath(release, rootDir);
  const bytes = readFileSync(path);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, release.migrationSha256, "migration bytes drifted");
  let rollbackDigest;
  if (release.rollback) {
    const rollbackBytes = readFileSync(join(rootDir, release.rollback.path));
    rollbackDigest = createHash("sha256").update(rollbackBytes).digest("hex");
    assert.equal(rollbackDigest, release.rollback.sha256, "rollback bytes drifted");
  }
  return Object.freeze({
    release,
    migrationPath: path,
    digest,
    rollbackDigest,
  });
}

function requiredReleaseId(env = process.env) {
  const releaseId = env.PRIVILEGE_RELEASE_ID;
  if (typeof releaseId !== "string" || releaseId !== releaseId.trim()) {
    throw stopped("PRIVILEGE_RELEASE_ID is required");
  }
  return releaseId;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const releaseId = requiredReleaseId();
    const verified = verifyPrivilegeReleaseSource(releaseId);
    const option = process.argv[2];
    if (option === "--tests") {
      process.stdout.write(`${verified.release.sourceTests.join("\n")}\n`);
    } else if (option === "--compatible-deployment") {
      process.stdout.write(
        `${verified.release.compatibleDeployment ? "required" : "none"}\n`,
      );
    } else if (option === "--minimum-compatible-app-commit") {
      process.stdout.write(
        `${verified.release.compatibleDeployment?.minimumAppCommit ?? ""}\n`,
      );
    } else if (option === undefined) {
      process.stdout.write(`${verified.release.migration}\n`);
    } else {
      throw stopped("CLI option is invalid");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
