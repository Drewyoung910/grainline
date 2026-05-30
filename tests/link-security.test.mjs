import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (/\.(tsx?|jsx?)$/.test(entry.name)) return [fullPath];
    return [];
  });
}

describe("link security", () => {
  it("keeps target blank links on a noopener/noreferrer rel", () => {
    const offenders = [];
    for (const file of [...walk("src/app"), ...walk("src/components")]) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/<(?:a|Link)\b[^>]*target="_blank"[^>]*>/g)) {
        const tag = match[0];
        if (!/rel="[^"]*(?:noopener|noreferrer)[^"]*"/.test(tag)) {
          offenders.push(`${file}:${source.slice(0, match.index).split("\n").length}`);
        }
      }
    }

    assert.deepEqual(offenders, []);
  });

  it("encodes tracking numbers before building carrier links", () => {
    const paths = [
      "src/components/LabelSection.tsx",
      "src/components/OrderTimeline.tsx",
      "src/app/dashboard/orders/[id]/page.tsx",
      "src/app/dashboard/sales/[orderId]/page.tsx",
    ];

    for (const file of paths) {
      const source = fs.readFileSync(file, "utf8");
      assert.match(source, /const trackingParam = encodeURIComponent\(/, file);
      assert.match(source, /tracknum=\$\{trackingParam\}/, file);
      assert.doesNotMatch(source, /tracknum=\$\{(?:labelTrackingNumber|number)\}/, file);
      assert.doesNotMatch(source, /tLabels=\$\{(?:labelTrackingNumber|number)\}/, file);
      assert.doesNotMatch(source, /trknbr=\$\{(?:labelTrackingNumber|number)\}/, file);
      assert.doesNotMatch(source, /tracking-id=\$\{(?:labelTrackingNumber|number)\}/, file);
    }
  });
});
