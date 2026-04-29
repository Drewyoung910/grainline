import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { AccountAccessError, accountAccessErrorPayload } = await import("../src/lib/accountAccessError.ts");

describe("account access API payloads", () => {
  it("returns a clean suspended-account payload for account-state errors", () => {
    const payload = accountAccessErrorPayload(
      new AccountAccessError("Your account has been suspended.", "ACCOUNT_SUSPENDED"),
    );

    assert.deepEqual(payload, {
      status: 403,
      body: {
        error: "Your account has been suspended.",
        code: "ACCOUNT_SUSPENDED",
      },
    });
  });

  it("returns a clean deleted-account payload for account-state errors", () => {
    const payload = accountAccessErrorPayload(
      new AccountAccessError("This account has been deleted.", "ACCOUNT_DELETED"),
    );

    assert.deepEqual(payload, {
      status: 403,
      body: {
        error: "This account has been deleted.",
        code: "ACCOUNT_DELETED",
      },
    });
  });

  it("does not mask unrelated errors", () => {
    assert.equal(accountAccessErrorPayload(new Error("boom")), null);
    assert.equal(accountAccessErrorPayload(null), null);
  });
});
