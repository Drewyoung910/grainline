import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const gallery = readFileSync("src/components/ListingGallery.tsx", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

describe("listing image delivery", () => {
  it("uses responsive optimized images for the visible photo and 64px thumbnails", () => {
    assert.match(gallery, /import Image from "next\/image"/u);
    assert.match(gallery, /sizes="\(max-width: 1023px\) 100vw, 50vw"/u);
    assert.match(gallery, /preload=\{activeIndex === 0\}/u);
    assert.match(gallery, /sizes="64px"/u);
    assert.doesNotMatch(
      gallery,
      /<img\s+src=\{p\.url\}/u,
      "thumbnail originals must not be downloaded into 64px slots",
    );
  });

  it("allows the optimizer to fetch current R2 and historical listing media", () => {
    assert.match(nextConfig, /const r2ImageRemotePatterns = imageRemotePatternsFromEnv/u);
    assert.match(nextConfig, /remotePatterns:\s*\[/u);
    assert.match(nextConfig, /"https:\/\/cdn\.thegrainline\.com"/u);
    assert.match(nextConfig, /hostname: "utfs\.io"/u);
    assert.match(nextConfig, /hostname: "\*\*\.ufs\.sh"/u);
  });
});
