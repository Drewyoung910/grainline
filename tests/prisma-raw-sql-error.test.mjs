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
  it("returns a valid SQLSTATE only for P2010 raw-query failures", () => {
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
    assert.equal(
      getPrismaRawSqlState(knownError("P2010", { code: "not-a-state" })),
      null,
    );
    assert.equal(getPrismaRawSqlState(new Error("42501")), null);
  });

  it("recognizes an exact cross-bundle Prisma error shape without instanceof", () => {
    const crossBundleError = Object.freeze({
      name: "PrismaClientKnownRequestError",
      code: "P2010",
      clientVersion: "7.4.2",
      meta: Object.freeze({ code: "23514", message: "Case is already terminal" }),
    });

    assert.equal(getPrismaRawSqlState(crossBundleError), "23514");
    assert.equal(
      getPrismaRawSqlState({ ...crossBundleError, name: "Error" }),
      null,
    );
    assert.equal(
      getPrismaRawSqlState({ ...crossBundleError, code: "P2002" }),
      null,
    );
    assert.equal(
      getPrismaRawSqlState({ ...crossBundleError, clientVersion: "" }),
      null,
    );
    assert.equal(
      getPrismaRawSqlState({ ...crossBundleError, meta: { code: 23514 } }),
      null,
    );
  });

  it("recognizes the exact Prisma PostgreSQL driver-adapter P2010 shape", () => {
    const adapterError = Object.freeze({
      name: "DriverAdapterError",
      cause: Object.freeze({
        kind: "postgres",
        code: "23514",
        severity: "ERROR",
        message: "Case is already terminal",
        originalCode: "23514",
        originalMessage: "Case is already terminal",
      }),
    });
    const knownAdapterError = knownError("P2010", {
      driverAdapterError: adapterError,
    });

    assert.equal(getPrismaRawSqlState(knownAdapterError), "23514");
    assert.equal(
      getPrismaRawSqlState(knownError("P2002", { driverAdapterError: adapterError })),
      null,
    );
    assert.equal(
      getPrismaRawSqlState(knownError("P2010", {
        driverAdapterError: { ...adapterError, name: "Error" },
      })),
      null,
    );
    assert.equal(
      getPrismaRawSqlState(knownError("P2010", {
        driverAdapterError: {
          ...adapterError,
          cause: { ...adapterError.cause, kind: "mysql" },
        },
      })),
      null,
    );
    assert.equal(
      getPrismaRawSqlState(knownError("P2010", {
        driverAdapterError: {
          ...adapterError,
          cause: { ...adapterError.cause, originalCode: "not-a-state" },
        },
      })),
      null,
    );
    assert.equal(
      getPrismaRawSqlState(knownError("P2010", {
        driverAdapterError: { ...adapterError, cause: null },
      })),
      null,
    );
  });
});
