import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { acknowledgeInventoryStockAttempt, prepareInventoryStockAttempt, readInventoryStockAttempt } from "../src/lib/inventoryStockAttempt.ts";

function storage() {
  const rows = new Map();
  return { getItem: (key) => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: (key) => rows.delete(key) };
}
test("reload and changed live stock preserve the exact pending request", () => {
  const store = storage();
  const first = prepareInventoryStockAttempt(store, "owner:listing", 10, 5);
  assert.deepEqual(readInventoryStockAttempt(store, "owner:listing"), first);
  assert.deepEqual(prepareInventoryStockAttempt(store, "owner:listing", 10, 7), first);
  assert.throws(() => prepareInventoryStockAttempt(store, "owner:listing", 15, 5), /pending/);
  assert.equal(readInventoryStockAttempt(store, "other:listing"), null);
});
test("lost, malformed, legacy and foreign acknowledgements retain retry state", () => {
  const store = storage(); const first = prepareInventoryStockAttempt(store, "k", 10, 5);
  for (const response of [null, {}, { stockQuantity: 10 }, { mutationId: "wrong", stockQuantity: 10 },
    { mutationId: first.mutationId, stockQuantity: null }, { mutationId: first.mutationId, stockQuantity: NaN }]) {
    assert.throws(() => acknowledgeInventoryStockAttempt(store, "k", first.mutationId, response));
    assert.deepEqual(readInventoryStockAttempt(store, "k"), first);
  }
  assert.equal(acknowledgeInventoryStockAttempt(store, "k", first.mutationId, { mutationId: first.mutationId, stockQuantity: 7 }), 7);
  assert.equal(readInventoryStockAttempt(store, "k"), null);
  assert.notEqual(prepareInventoryStockAttempt(store, "k", 12, 7).mutationId, first.mutationId);
});
test("unavailable/corrupt storage and invalid quantities do not mint competing attempts", () => {
  const store = storage();
  store.setItem("k", "bad");
  assert.throws(() => prepareInventoryStockAttempt(store, "k", 10, 5));
  store.removeItem("k");
  for (const quantity of [NaN, Infinity, -1, 1.5, 1_000_001]) {
    assert.throws(() => prepareInventoryStockAttempt(store, "k", quantity, 5));
    assert.equal(store.getItem("k"), null);
  }
  assert.throws(() => prepareInventoryStockAttempt({ ...store, setItem() { throw Error("storage denied"); } }, "k", 10, 5));
});
test("both screens share the explicit stock control; content save cannot submit its quantity", () => {
  const control = readFileSync("src/components/InventoryQuantityControl.tsx", "utf8");
  assert.match(control, /stock\/adjustments/);
  assert.match(control, /type="button"/);
  assert.doesNotMatch(control, /name="stockQuantity"/);
  assert.match(control, /pendingAttempt \|\| !journalReady/);
  assert.match(control, /res.status === 409 && data\?\.mutationNotApplied === true/);
  assert.match(control, /prepareInventoryStockAttempt[\s\S]*await fetch/);
  for (const path of ["src/app/dashboard/inventory/InventoryRow.tsx", "src/app/dashboard/listings/[id]/edit/page.tsx"]) {
    assert.match(readFileSync(path, "utf8"), /InventoryQuantityControl/);
  }
  assert.match(readFileSync("src/app/api/listings/[id]/stock/adjustments/route.ts", "utf8"), /export \{ PATCH \} from "\.\.\/route"/);
});
