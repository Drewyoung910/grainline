import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { getPrismaRawSqlState } from "../src/lib/prismaRawSqlError.ts";

function knownError(code, meta) {
  return new Prisma.PrismaClientKnownRequestError("test error", {
    code,
    clientVersion: "test",
    meta,
  });
}

describe("Prisma raw SQL error classification", () => {
  it("returns a string SQLSTATE only for P2010 raw-query failures", () => {
    assert.equal(
      getPrismaRawSqlState(knownError("P2010", { code: "42501" })),
      "42501",
    );
    assert.equal(
      getPrismaRawSqlState(knownError("P2002", { code: "23505" })),
      null,
    );
    assert.equal(
      getPrismaRawSqlState(knownError("P2010", { code: 42501 })),
      null,
    );
    assert.equal(getPrismaRawSqlState(new Error("42501")), null);
  });
});
