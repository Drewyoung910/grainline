#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE_ID = /^[a-z0-9_]+$/u;

export const PRIVILEGE_RELEASES = Object.freeze({
  email_service_v1: Object.freeze({
    migration: "20261101090000_activate_email_service_least_privilege",
    migrationSha256:
      "4c9c30b2b95854f5dfe587532ecfb98a0698e54c2c50cf49cfdb4fdf0c8f02cf",
    preparationMigration: Object.freeze({
      name: "20261101080000_prepare_email_service_least_privilege",
      sha256:
        "a00d71f078a8e2cb38d376292592011861904b77a9ba282e186669a8d142e803",
    }),
    minimumCompatibleAppCommit:
      "d6e576aff2838df4c773119ad63252ba1c63d232",
    rollback: Object.freeze({
      path: "docs/rls-drafts/email-service-least-privilege-activation-rollback.sql",
      sha256:
        "7b71d49dccb3b9ea98de425b6cdc959e731fd31cc2d2d9511bd75eaabb21cdcb",
    }),
    sourceTests: Object.freeze([
      "tests/email-service-least-privilege-activation.test.mjs",
    ]),
    laterPendingMigrations: Object.freeze([]),
    tables: Object.freeze({
      EmailFailureCount: Object.freeze([]),
      EmailOutbox: Object.freeze([]),
      EmailSuppression: Object.freeze([]),
      NewsletterSubscriber: Object.freeze([]),
      ResendWebhookEvent: Object.freeze([]),
    }),
    emptyTables: Object.freeze(["EmailFailureCount"]),
    predecessorRuntimeFunctions: Object.freeze([
      "public.grainline_account_deletion_email_key_core(text)",
    ]),
    functions: Object.freeze({
      "public.grainline_email_hard_suppression_apply(text,text,\"EmailSuppressionReason\",text,text,jsonb)": "26b56879c36244c42a16eeae66f06813d1c5d53fad5b0eb59a71410910dc942b",
      "public.grainline_email_account_deletion_suppression_clear(text)": "2a4e35437f915c3fcf9877f79dd32ea4abeebc1741b92d6c1e15a0fc8029c05a",
      "public.grainline_email_one_click_suppression_clear(text)": "a4ebf17c34f920a2e715a62dee22df036ddfd32e2e08188e5bba865e6937aa56",
      "public.grainline_email_outbox_account_deletion_fence(text,text[])": "d6ee02f559fec2fd3e2dbf9c9925dcfecf6988e97b8c7595895585b25851eb8e",
      "public.grainline_email_outbox_begin_provider_attempt(text,bigint,uuid)": Object.freeze([
        "acb3d41117e8b8a88fbe3fd055cdc1824b8a32eaebf4f40fb687c8ef7516289e",
        "ef145be432a0ffcbbf02e6dc9419d90d7b0ec3dec23a9d1eb0a83aff0a16393a",
      ]),
      "public.grainline_email_outbox_cancel_seller_broadcast(text)": "8c0fc3a6975c1d4735741ae58062b4e55b3674ff2b898bbd17f2f951285a7f63",
      "public.grainline_email_outbox_claim_batch(integer)": "821da02132dba680a82444eae5bd2fb1a3690309996cc222a0a10234b199bd22",
      "public.grainline_email_outbox_claim_one(text)": "76d1a2048afa03dce1d4399df5da6abf0fb7d4f555498efe56c22712dce5beb2",
      "public.grainline_email_outbox_complete(text,bigint,uuid,text)": "45005ed25acc47482377c346493798a1109ab882554b206a3e87cb46d01def99",
      "public.grainline_email_outbox_defer(text,bigint,uuid,text)": "3577fd4fe7462d1d33b624f5eeeec85f5e58e62d21520c99185bb6741c147653",
      "public.grainline_email_outbox_enqueue_legacy(text,text,text,text,text,integer,text,text,text,text,text)": "7ad90a7a87fe6bbae4d846f0dba88576906eb1728f35349fc0d547cf144e8d1e",
      "public.grainline_email_outbox_fail(text,bigint,uuid,text,text)": "26e4c8ffa873f11a5cd0cd19a13aa9981e32c43b9112c8bfe1af597002e97004",
      "public.grainline_email_outbox_redact_deleted_seller(text)": "9aa2e82a2ff04e76b5d348eaadaef5a75f6ee19fe5418c14f773e55be38f9e92",
      "public.grainline_email_outbox_retention_delete_batch(timestamp without time zone,timestamp without time zone,integer)": "468cb771e6840700dcfdddecbcde5b1501316858d689b94a049ee8c7c864ceb6",
      "public.grainline_email_outbox_skip(text,bigint,uuid,text)": "a9f62d9109e27f2b57d371d0acb24ad5854f67f00c24558421ba39e67641290e",
      "public.grainline_email_service_account_deletion_apply(text,bigint,uuid)": "9b5ee1b21cf5ea4b1f078c92890808e16235063b6c89f40168d8a53c61f94503",
      "public.grainline_email_service_ops_health(timestamp without time zone,timestamp without time zone)": "78cc50d4b586d3af14b98cf84a9daeaf1ab24b7688c87afa3b259d692a68c3fc",
      "public.grainline_email_service_owner_export()": "93c059bc2d45af771cd2d57265538b0fca157c01a22ed05ac5dfecaeb1e30143",
      "public.grainline_email_suppression_exists(text,text)": "c920bc1309cdbe46902c831d3f00b7b3bc023ac7ddeb2fe135ac33658b8c57dd",
      "public.grainline_email_unsubscribe_apply(text,jsonb)": "02c5cbc6684514e1a1d0f663c567812158920cfffdd5a36d28472149c0ff1a79",
      "public.grainline_newsletter_confirm(text,timestamp without time zone)": "6b963b1a927edab5b206c43c38a5a21cb025a8f6b01df700152ef40f6d129bbe",
      "public.grainline_newsletter_confirmation_valid(text,timestamp without time zone)": "524a0d7765a1e839b7926e85d87da735f5aa40ca19a0bc08f64e65fab9094a25",
      "public.grainline_newsletter_expired_unconfirmed_delete_batch(timestamp without time zone,integer)": "92a323901d50e1bad2fa54168ccea655de3a051a040e925c95a4dc2bb55046fb",
      "public.grainline_newsletter_signup_release(text,text)": "ce36db1c305ae3c194231034642590ea32e0b1101c272b7816e983f13d1997a6",
      "public.grainline_newsletter_signup_reserve(text,text,text,timestamp without time zone,timestamp without time zone,timestamp without time zone)": "bf00f56a9e43fc9e7a932af7677743ac090af0c9f0ca465425816ce23fd7b404",
      "public.grainline_newsletter_token_superseded(text,timestamp without time zone)": "fba314d8e03139b26bb59921e7784af89d683234a5ca51e32a5f95ac2298ed42",
      "public.grainline_resend_webhook_event_complete(text,bigint,uuid,timestamp without time zone)": "cf83773b769a3383253536cd64234cb41531bf6dca81bc646e97af4c6d72bdfd",
      "public.grainline_resend_webhook_event_fail(text,bigint,uuid,text,timestamp without time zone)": "688957102e0d875e0660b178fd6d0d0f111c5c9d5a42f87b0daf8f32dc6219bd",
      "public.grainline_resend_webhook_event_reserve(text,text,timestamp without time zone,timestamp without time zone,uuid)": "5db829b64af5a9749204ce9aafdcee27c1a8026e2caa7a8c9a7130fbb9715dd0",
      "public.grainline_resend_webhook_event_retention_delete_batch(timestamp without time zone,integer)": "8877e5067e8e3434f909f43c9bfeed250899f0de0f02da66c59def4f4ca81b9f",
    }),
  }),
  service_reference_v1: Object.freeze({
    minimumCompatibleAppCommit:
      "b56e226d327347fe155aa07ded0bde999ca929be",
    migration: "20261101020000_narrow_service_reference_runtime_privileges",
    migrationSha256:
      "5ae6d88826690ae5f0a653c02c87ae28fc76bb9f3609119402b2590594edbc6c",
    sourceTests: Object.freeze([
      "tests/service-reference-least-privilege.test.mjs",
    ]),
    laterPendingMigrations: Object.freeze([
      "20261101080000_prepare_email_service_least_privilege",
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
    } else if (option === "--minimum-compatible-app-commit") {
      process.stdout.write(`${verified.release.minimumCompatibleAppCommit}\n`);
    } else if (option === "--later-pending-migrations") {
      if (verified.release.laterPendingMigrations.length > 0) {
        process.stdout.write(
          `${verified.release.laterPendingMigrations.join("\n")}\n`,
        );
      }
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
