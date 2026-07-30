import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  validateCaseAccountDeletionBlockerRows,
  validateCaseAccountDeletionRedactionRows,
} from "../src/lib/caseAccountDeletionResult.ts";

describe("Case account-deletion application authority", () => {
  it("accepts one exact blocker count", () => {
    const count = validateCaseAccountDeletionBlockerRows([{ count: 2n }]);
    assert.equal(count, 2);
  });

  it("rejects invalid blocker projections", () => {
    for (const rows of [
      [],
      [{ count: -1 }],
      [{ count: "1.5" }],
      [{ count: 1, extra: true }],
    ]) {
      assert.throws(
        () => validateCaseAccountDeletionBlockerRows(rows),
        /invalid/,
      );
    }
  });

  it("accepts only the exact redaction identity and shape", () => {
    const result = validateCaseAccountDeletionRedactionRows(
      [{
        sideEffectId: "effect-1",
        userId: "user-1",
        authoredMessagesRedacted: 1,
        quotedMessagesRedacted: 2,
        buyerDescriptionsRedacted: 1,
        participantDescriptionsRedacted: 3,
      }],
      { sideEffectId: "effect-1", userId: "user-1" },
    );
    assert.deepEqual(result, {
      sideEffectId: "effect-1",
      userId: "user-1",
      authoredMessagesRedacted: 1,
      quotedMessagesRedacted: 2,
      buyerDescriptionsRedacted: 1,
      participantDescriptionsRedacted: 3,
    });
  });

  it("rejects malformed or drifted redaction results", () => {
    const valid = {
      sideEffectId: "effect-1",
      userId: "user-1",
      authoredMessagesRedacted: 1,
      quotedMessagesRedacted: 2,
      buyerDescriptionsRedacted: 1,
      participantDescriptionsRedacted: 3,
    };
    for (const row of [
      { ...valid, sideEffectId: "effect-2" },
      { ...valid, userId: "user-2" },
      { ...valid, quotedMessagesRedacted: -1 },
      { ...valid, extra: true },
    ]) {
      assert.throws(
        () => validateCaseAccountDeletionRedactionRows(
          [row],
          { sideEffectId: "effect-1", userId: "user-1" },
        ),
        /invalid|drifted/,
      );
    }
  });

  it("removes ordinary Case access from account deletion", () => {
    const deletion = fs.readFileSync(
      "src/lib/accountDeletion.ts",
      "utf8",
    );
    assert.match(deletion, /getCaseAccountDeletionBlockerCount\(userId\)/);
    assert.match(
      deletion,
      /redactCaseDataForAccountDeletion\([\s\S]*sideEffectId: localAnonymizeSideEffectId[\s\S]*userId: user\.id/,
    );
    assert.doesNotMatch(
      deletion,
      /(?:tx|prisma)\.(?:case|caseMessage|caseMessageAttachment)\./,
    );
    assert.doesNotMatch(
      deletion,
      /FROM\s+"(?:Case|CaseMessage|CaseMessageAttachment)"/,
    );
  });
});
