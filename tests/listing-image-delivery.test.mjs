import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { imageRemotePatternsFromValues } from "../src/lib/imageRemotePatterns.ts";

const gallery = readFileSync("src/components/ListingGallery.tsx", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

describe("listing image delivery", () => {
  it("optimizes first-party photos, then falls back without losing the image", () => {
    assert.match(gallery, /import Image from "next\/image"/u);
    assert.match(gallery, /import \{ isFirstPartyMediaUrl \} from "@\/lib\/urlValidation"/u);
    assert.match(gallery, /const \[optimizerFailures, setOptimizerFailures\]/u);
    assert.match(
      gallery,
      /unoptimized=\{!isFirstPartyMediaUrl\(activeUrl\) \|\| optimizerFailures\.has\(activeUrl\)\}/u,
    );
    assert.match(
      gallery,
      /unoptimized=\{!isFirstPartyMediaUrl\(p\.url\) \|\| optimizerFailures\.has\(p\.url\)\}/u,
    );
    assert.match(
      gallery,
      /setOptimizerFailures\(\(current\) => new Set\(current\)\.add\(activeUrl\)\)/u,
    );
    assert.match(
      gallery,
      /setOptimizerFailures\(\(current\) => new Set\(current\)\.add\(p\.url\)\)/u,
    );
    assert.match(gallery, /sizes="\(max-width: 1023px\) 100vw, 50vw"/u);
    assert.match(gallery, /preload=\{activeIndex === 0\}/u);
    assert.match(gallery, /sizes="64px"/u);
    assert.doesNotMatch(
      gallery,
      /<img\s+src=\{p\.url\}/u,
      "thumbnail originals must not be downloaded into 64px slots",
    );
  });

  it("limits the optimizer to queryless first-party media path prefixes", () => {
    assert.match(nextConfig, /const r2ImageRemotePatterns = imageRemotePatternsFromValues/u);
    assert.match(nextConfig, /remotePatterns: r2ImageRemotePatterns/u);
    assert.match(nextConfig, /"https:\/\/cdn\.thegrainline\.com"/u);
    assert.doesNotMatch(nextConfig, /hostname: "utfs\.io"/u);
    assert.doesNotMatch(nextConfig, /hostname: "\*\*\.ufs\.sh"/u);

    assert.deepEqual(
      imageRemotePatternsFromValues([
        "https://cdn.thegrainline.com/media/",
        "https://cdn.thegrainline.com/media/",
        "http://insecure.example/media",
        "not a URL",
      ]),
      [{
        protocol: "https",
        hostname: "cdn.thegrainline.com",
        port: "",
        pathname: "/media/**",
        search: "",
      }],
    );
  });
});
