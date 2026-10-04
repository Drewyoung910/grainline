import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const report = JSON.parse(
  execFileSync(
    process.execPath,
    ["scripts/audit-user-direct-calls.mjs", "--json"],
    { encoding: "utf8" },
  ),
);

test("User direct-access inventory records bounded Clerk identity conversions", () => {
  assert.equal(report.count, 54);
  assert.equal(report.files, 30);
  assert.deepEqual(report.byMethod, {
    count: 3,
    findFirst: 1,
    findMany: 5,
    findUnique: 37,
    update: 5,
    updateMany: 3,
  });

  const fullRowReads = report.calls.filter(
    (call) =>
      ["findFirst", "findMany", "findUnique"].includes(call.method) &&
      call.select.length === 0 &&
      call.include.length === 0,
  );
  assert.equal(fullRowReads.length, 0);

  const writes = report.calls.filter((call) =>
    ["create", "update", "updateMany", "delete", "deleteMany", "upsert"].includes(
      call.method,
    ),
  );
  assert.equal(writes.length, 8);

  const obsoleteClerkGateReads = report.calls.filter(
    (call) =>
      call.method === "findUnique" &&
      call.where.length === 1 &&
      call.where[0] === "clerkId" &&
      [...call.select].sort().join(",") === "banned,deletedAt,id,role",
  );
  assert.equal(obsoleteClerkGateReads.length, 0);
  const obsoleteClerkAccountStateReads = report.calls.filter(
    (call) =>
      call.method === "findUnique" &&
      call.where.length === 1 &&
      call.where[0] === "clerkId" &&
      [...call.select].sort().join(",") === "banned,deletedAt,id",
  );
  assert.equal(obsoleteClerkAccountStateReads.length, 0);
  const obsoleteClerkIdReads = report.calls.filter(
    (call) =>
      call.method === "findUnique" &&
      call.where.length === 1 &&
      call.where[0] === "clerkId" &&
      call.select.length === 1 &&
      call.select[0] === "id",
  );
  assert.equal(obsoleteClerkIdReads.length, 0);
  assert.deepEqual(
    [...new Set(writes.map((call) => call.file))].sort(),
    [
      "src/app/api/account/accept-terms/route.ts",
      "src/app/api/account/shipping-address/route.ts",
      "src/lib/accountDeletion.ts",
      "src/lib/audit.ts",
      "src/lib/ban.ts",
      "src/lib/unsubscribe.ts",
    ],
  );
});
