import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const client = readFileSync("src/lib/orderStaffReadDb.ts", "utf8");

describe("Order staff read database client contract", () => {
  it("authenticates directly as the dedicated role with a separate bounded pool", () => {
    assert.match(client, /ORDER_STAFF_READ_DATABASE_URL/);
    assert.match(client, /grainline_staff_read_runtime/);
    assert.match(client, /decodeURIComponent\(staff\.username\)/);
    assert.match(client, /must authenticate directly as/);
    assert.match(client, /must use a pooled endpoint/);
    assert.match(client, /same pooled database as DATABASE_URL/);
    assert.match(client, /max: 2/);
  });

  it("is lazy, server-only, and has no ordinary-client fallback", () => {
    assert.match(client, /^import "server-only";/);
    assert.match(client, /export function getOrderStaffReadClient\(\)/);
    assert.doesNotMatch(client, /from "@\/lib\/db"/);
    assert.doesNotMatch(client, /\?\? prisma|\|\| prisma/);
    assert.ok(
      client.indexOf("function createOrderStaffReadClient")
        < client.indexOf("export function getOrderStaffReadClient"),
    );
  });
});
