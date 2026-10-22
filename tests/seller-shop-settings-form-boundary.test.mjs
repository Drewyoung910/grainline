import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/dashboard/seller/page.tsx", "utf8");
const picker = readFileSync("src/components/LocationPicker.tsx", "utf8");

test("shop settings preserve unsaved edits and pass only address defaults to the client", () => {
  assert.match(page, /<ActionForm action=\{updateSellerProfile\}[^>]*preserveOnError/u);
  assert.doesNotMatch(page, /SellerShipFromAddressFields defaults=\{currentRow/u);
  assert.match(page, /<SellerShipFromAddressFields\s+defaults=\{\{/u);
  assert.match(page, /shipFromPhone: currentRow\?\.shipFromPhone/u);
});

test("the visual map center is never submitted as an unsaved seller location", () => {
  assert.match(picker, /const \[pos, setPos\] = useState<\[number, number\] \| null>/u);
  assert.match(picker, /name="lat" value=\{pos\?\.\[0\] \?\? ""\}/u);
  assert.match(picker, /name="lng" value=\{pos\?\.\[1\] \?\? ""\}/u);
  assert.match(picker, /name="radiusMeters" value=\{pos \? meters : ""\}/u);
});
