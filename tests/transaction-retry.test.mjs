import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { isSerializableRetryError, withSerializableRetry } = await import("../src/lib/transactionRetry.ts");

describe("serializable transaction retry", () => {
  it("recognizes Prisma and database serialization failures", () => {
    assert.equal(isSerializableRetryError({ code: "P2034" }), true);
    assert.equal(isSerializableRetryError({ code: "40001" }), true);
    assert.equal(isSerializableRetryError({ message: "could not serialize access due to concurrent update" }), true);
    assert.equal(isSerializableRetryError({ code: "P2002" }), false);
  });

  it("retries retryable failures and returns the successful result", async () => {
    let attempts = 0;
    const result = await withSerializableRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw { code: "40001" };
      return "ok";
    }, 3);

    assert.equal(result, "ok");
    assert.equal(attempts, 3);
  });

  it("does not retry non-serializable failures", async () => {
    let attempts = 0;
    await assert.rejects(
      withSerializableRetry(async () => {
        attempts += 1;
        throw { code: "P2002" };
      }, 3),
      { code: "P2002" },
    );
    assert.equal(attempts, 1);
  });
});
