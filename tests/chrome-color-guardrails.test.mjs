import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// The brand chrome green (#3F5D3A and related green-family hexes) was removed
// from site chrome on 2026-07-10 in favor of the warm cream palette
// (#F7F5F0 body, #EFEAE0 accent, #2C1F1A espresso actions). GuildBadge keeps
// its green wreath artwork because that is badge identity, not site chrome.
// Semantic Tailwind green-* classes (success banners, In Stock, completed
// timeline dots) are also intentionally untouched by this guard.
const BANNED_CHROME_HEXES =
  /#(?:3F5D3A|345030|D9E2D5|C7D4C2|2F4A2B|4A6741)\b/gi;

const ALLOWED_FILES = new Set([
  // Badge artwork — green wreath palette is the Guild Member identity.
  path.normalize("src/components/GuildBadge.tsx"),
]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (/\.(tsx?|jsx?|css)$/.test(entry.name)) return [fullPath];
    return [];
  });
}

describe("chrome color guardrails", () => {
  it("keeps retired chrome green hexes out of src (GuildBadge artwork excepted)", () => {
    const offenders = [];
    for (const file of walk("src")) {
      if (ALLOWED_FILES.has(path.normalize(file))) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(BANNED_CHROME_HEXES)) {
        offenders.push(
          `${file}:${source.slice(0, match.index).split("\n").length} ${match[0]}`
        );
      }
    }

    assert.deepEqual(offenders, []);
  });

  it("keeps CLAUDE.md aligned with the cream/espresso chrome contract", () => {
    const docs = fs.readFileSync("CLAUDE.md", "utf8");

    assert.match(docs, /site chrome uses two cream tones plus espresso/);
    assert.match(docs, /former chrome green `#3F5D3A`/);
    assert.match(docs, /Header and footer are cream/);
    assert.match(docs, /ring-4 ring-\[#F7F5F0\] shadow-sm/);
    assert.doesNotMatch(docs, /header and footer both use `bg-\[#3F5D3A\]`/i);
    assert.doesNotMatch(docs, /espresso logo uses `brightness-0 invert`/i);
    assert.doesNotMatch(docs, /Icon buttons inside the header use `text-stone-100 hover:bg-white\/10 rounded-full`/);
    assert.doesNotMatch(docs, /seller banner-overlap avatar may use `ring-4 ring-neutral-200 shadow-sm`/);
  });
});
