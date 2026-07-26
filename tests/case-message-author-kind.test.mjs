import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  caseMessageAuthorKindForActor,
  caseMessageAuthorLabel,
} from "../src/lib/caseMessageAuthor.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("CaseMessage durable author kind", () => {
  it("derives the author kind from the parent parties before staff role", () => {
    assert.equal(
      caseMessageAuthorKindForActor({
        actorId: "buyer",
        buyerId: "buyer",
        sellerId: "seller",
        isStaff: true,
      }),
      "BUYER",
    );
    assert.equal(
      caseMessageAuthorKindForActor({
        actorId: "seller",
        buyerId: "buyer",
        sellerId: "seller",
        isStaff: true,
      }),
      "SELLER",
    );
    assert.equal(
      caseMessageAuthorKindForActor({
        actorId: "staff",
        buyerId: "buyer",
        sellerId: "seller",
        isStaff: true,
      }),
      "STAFF",
    );
    assert.throws(
      () =>
        caseMessageAuthorKindForActor({
          actorId: "foreign",
          buyerId: "buyer",
          sellerId: "seller",
          isStaff: false,
        }),
      /CASE_MESSAGE_AUTHOR_UNAVAILABLE/,
    );
  });

  it("renders the durable snapshot even if the current User role later changes", () => {
    assert.equal(
      caseMessageAuthorLabel({
        authorKind: "BUYER",
        authorId: "buyer",
        buyerId: "buyer",
        sellerId: "seller",
        legacyAuthorRole: "ADMIN",
      }),
      "Buyer",
    );
    assert.equal(
      caseMessageAuthorLabel({
        authorKind: "STAFF",
        authorId: "former-staff",
        buyerId: "buyer",
        sellerId: "seller",
        legacyAuthorRole: "USER",
      }),
      "Grainline Staff",
    );
  });

  it("keeps only a documented legacy fallback until protected classification", () => {
    assert.equal(
      caseMessageAuthorLabel({
        authorKind: null,
        authorId: "legacy-staff",
        buyerId: "buyer",
        sellerId: "seller",
        legacyAuthorRole: "EMPLOYEE",
      }),
      "Grainline Staff",
    );

    const schema = source("prisma/schema.prisma");
    const authorMigration = source(
      "prisma/migrations/20260726183000_prepare_case_message_author_kind/migration.sql",
    );
    const indexMigration = source(
      "prisma/migrations/20260726183500_prepare_case_message_history_index/migration.sql",
    );
    const indexCleanupMigration = source(
      "prisma/migrations/20260726183600_drop_legacy_case_message_history_indexes/migration.sql",
    );
    assert.match(schema, /enum CaseMessageAuthorKind \{\s*BUYER\s*SELLER\s*STAFF\s*\}/s);
    assert.match(schema, /authorKind CaseMessageAuthorKind\?/);
    assert.match(schema, /@@index\(\[caseId, createdAt, id\]\)/);
    assert.match(authorMigration, /authorKind is intentionally nullable/);
    assert.match(authorMigration, /\bBEGIN;/);
    assert.match(authorMigration, /\bCOMMIT;/);
    assert.doesNotMatch(authorMigration, /CONCURRENTLY/);
    assert.match(
      indexMigration,
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS "CaseMessage_caseId_createdAt_id_idx"/,
    );
    assert.doesNotMatch(indexMigration, /DROP INDEX/);
    assert.match(
      indexCleanupMigration,
      /DROP INDEX IF EXISTS "CaseMessage_caseId_createdAt_idx"/,
    );
    assert.match(
      indexCleanupMigration,
      /DROP INDEX IF EXISTS "CaseMessage_caseId_idx"/,
    );
    assert.doesNotMatch(indexCleanupMigration, /CONCURRENTLY/);
  });

  it("sets the kind on every current CaseMessage creation path", () => {
    const createRoute = source("src/app/api/cases/route.ts");
    const replyRoute = source("src/app/api/cases/[id]/messages/route.ts");
    const history = source("src/lib/caseMessageHistory.ts");

    assert.match(createRoute, /authorKind: "BUYER"/);
    assert.match(replyRoute, /caseMessageAuthorKindForActor/);
    assert.match(replyRoute, /authorKind,\s*body: messageBody/s);
    assert.match(history, /authorKind: true/);
  });
});
