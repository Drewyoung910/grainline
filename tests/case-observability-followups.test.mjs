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
    const transactionStart = route.indexOf("const messageResult = await prisma.$transaction");
    const notificationStart = route.indexOf("// Notify the appropriate party/parties");

    assert.match(route, /CASE_MESSAGE_DEDUP_WINDOW_MS = 30_000/);
    assert.match(route, /pg_advisory_xact_lock\(hashtext/);
    assert.match(
      route,
      /caseMessage\.findMany\(\{\s*where: \{\s*caseId: id,\s*authorId: lockedActor\.id,\s*body: messageBody,\s*createdAt: \{ gte: duplicateCutoff \}/s,
    );
    assert.match(
      route,
      /duplicateCandidates\.find\(\(candidate\) =>\s*attachmentKeysMatch\(candidate\.attachments, attachmentKeys\)/s,
    );
    assert.match(
      route,
      /if \(messageResult\.duplicate\) \{\s*return privateJson\(caseMessageResponse\(messageResult\.message\), \{\s*status: 200,/s,
    );
    assert.ok(transactionStart !== -1 && notificationStart !== -1 && transactionStart < notificationStart);
  });

  it("keeps under-review case messages staff-only at the API boundary", () => {
    const route = source("src/app/api/cases/[id]/messages/route.ts");

    assert.match(
      route,
      /lockedActsAsStaff = lockedIsStaff && !lockedIsParty/,
    );
    assert.match(
      route,
      /canCreateCaseMessageForStatus\(lockedCase\.status, \{\s*isStaff: lockedActsAsStaff/s,
    );
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
