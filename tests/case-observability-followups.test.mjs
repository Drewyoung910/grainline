import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("case route observability follow-ups", () => {
  it("captures case message email side-effect failures without blocking the main mutation", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");

    assert.match(route, /source: "case_staff_message_email"/);
    assert.match(route, /source: "case_party_message_email"/);
    assert.doesNotMatch(route, /catch\s*\{\s*\/\* non-fatal \*\/\s*\}/);
  });

  it("serializes duplicate case message submits before notification side effects", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");
    const migration = source(
      "prisma/migrations/20260729052000_prepare_case_reply_authority/migration.sql",
    );
    const authorityStart = route.indexOf("await replyToCaseWithFixedAuthority({");
    const notificationStart = route.indexOf("// Notify the appropriate party/parties");

    assert.match(migration, /duplicate_cutoff := transition_at - INTERVAL '30 seconds'/);
    assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/);
    assert.match(
      migration,
      /message\."caseId" = locked_case\.id[\s\S]*message\."authorId" = locked_actor\.id[\s\S]*message\.body = p_body/,
    );
    assert.match(
      migration,
      /pg_catalog\.array_agg\([\s\S]*row\."directUploadId"[\s\S]*\) = normalized_upload_ids/,
    );
    assert.match(
      route,
      /if \(result\.action === "replay"\) \{\s*return privateJson\(message, \{ status: 200 \}\)/,
    );
    assert.ok(authorityStart !== -1 && notificationStart > authorityStart);
  });

  it("keeps under-review case messages staff-only at the API boundary", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");
    const migration = source(
      "prisma/migrations/20260729052000_prepare_case_reply_authority/migration.sql",
    );

    assert.match(
      migration,
      /actor_acts_as_staff :=\s*NOT actor_is_party/,
    );
    assert.match(
      migration,
      /actor_acts_as_staff[\s\S]*'UNDER_REVIEW'::public\."CaseStatus"[\s\S]*NOT actor_acts_as_staff/,
    );
    assert.match(route, /isNonPartyStaff = isStaff && !isParty/);
  });

  it("renders admin case deadlines with client-local dates", () => {
    const page = source("src/app/admin/cases/[id]/page.tsx");

    assert.match(page, /import LocalDate from "@\/components\/LocalDate"/);
    assert.match(page, /<LocalDate date=\{caseRecord\.sellerRespondBy\} \/>/);
    assert.doesNotMatch(page, /deadline\.toLocaleString/);
  });

  it("co-commits case resolution history and staff audit before notification side effects", () => {
    const route = source("src/app/api/cases/[id]/resolve/route.ts");
    const authority = source(
      "prisma/migrations/20260729045000_prepare_case_staff_resolution_authority/migration.sql",
    );
    const finalize = route.indexOf("await finalizeCaseStaffResolution");
    const sellerNotification = route.indexOf("source: \"case_seller_resolution_notification\"");

    assert.match(route, /source: "case_resolved_email"/);
    assert.match(route, /sourceType: NOTIFICATION_SOURCE_TYPES\.CASE_MESSAGE/);
    assert.match(authority, /'STAFF'::public\."CaseMessageAuthorKind"/);
    assert.match(authority, /'RESOLVE_CASE'/);
    assert.match(authority, /INSERT INTO public\."CaseMessage"/);
    assert.match(authority, /INSERT INTO public\."AdminAuditLog"/);
    assert.match(authority, /status = 'FINALIZED'/);
    assert.match(route, /source: "case_refund_provider_record_failed"/);
    assert.match(route, /source: "case_refund_ambiguous_record_failed"/);
    assert.doesNotMatch(route, /catch\s*\{\s*\/\* non-fatal \*\/\s*\}/);
    assert.doesNotMatch(route, /\.catch\(\(\) => \{\}\)/);
    assert.ok(
      finalize >= 0 && sellerNotification > finalize,
      "resolution message and audit must commit before seller notification",
    );
  });
});
