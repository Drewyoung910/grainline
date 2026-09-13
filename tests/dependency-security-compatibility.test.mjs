import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { mergeAttributes } from "@tiptap/core";
import yaml from "js-yaml";
import sharp from "sharp";
import { MAPLIBRE_WORKER_FILES, prepareMaplibreAssets } from "../scripts/prepare-maplibre-assets.mjs";

const require = createRequire(import.meta.url);
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

describe("dependency security compatibility", () => {
  it("aligns every editor extension and its exact core peers", () => {
    const entries = Object.entries(lock.packages).filter(([path]) => path.includes("node_modules/@tiptap/"));
    assert.ok(entries.length >= 25);
    for (const [path, entry] of entries) assert.equal(entry.version, "3.31.3", path);
    assert.equal(lock.packages["node_modules/maplibre-gl"].version, "6.4.1");
  });

  it("does not inherit attacker-supplied DOM attributes while preserving ordinary merges", () => {
    const result = mergeAttributes(JSON.parse('{"__proto__":{"onload":"synthetic"}}'));
    assert.equal(result.onload, undefined);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.getOwnPropertyDescriptor(result, "__proto__").value.onload, "synthetic");
    const ordinary = mergeAttributes({ class: "one", title: "before" }, { class: "two", title: "after" });
    assert.equal(ordinary.class, "one two");
    assert.equal(ordinary.title, "after");
  });

  it("counts empty YAML merge sources against the configured budget", () => {
    assert.throws(() => yaml.load("base: &base [{}, {}, {}, {}]\nresult:\n  <<: *base", {
      maxTotalMergeKeys: 2,
    }), /merge/i);
    assert.deepEqual(yaml.load("base: &base {enabled: true}\nresult:\n  <<: *base", {
      maxTotalMergeKeys: 2,
    }), { base: { enabled: true }, result: { enabled: true } });
  });

  it("bounds malformed markdown attributes without breaking legitimate tokenizers", () => {
    // A subprocess deadline bounds even a synchronous parser regression. This
    // is a hang guard, not a throughput benchmark or a production load test.
    execFileSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import {createAtomBlockMarkdownSpec, createBlockMarkdownSpec, createInlineMarkdownSpec} from "@tiptap/core";
      const atom = createAtomBlockMarkdownSpec({nodeName: "synthetic"});
      const block = createBlockMarkdownSpec({nodeName: "synthetic"});
      const inline = createInlineMarkdownSpec({nodeName: "synthetic", selfClosing: true});
      const lexer = {blockTokens: () => []};
      const good = 'title="safe"';
      for (const attributes of [good, 'a'.repeat(50_000) + '="']) {
        const a = atom.markdownTokenizer.tokenize(':::synthetic {' + attributes + '} :::');
        const b = block.markdownTokenizer.tokenize(':::synthetic {' + attributes + '}\\ncontent\\n:::', [], lexer);
        const c = inline.markdownTokenizer.tokenize('[synthetic ' + attributes + ']');
        if (attributes === good) for (const result of [a, b, c]) assert.equal(result.attributes.title, "safe");
      }
    `], { timeout: 10_000, stdio: "pipe" });
  });

  it("loads the patched native image decoder and preserves accepted image formats", async () => {
    assert.equal(sharp.versions.sharp, "0.35.4");
    const heif = sharp.versions.heif?.split(".").map(Number);
    assert.ok(heif && (heif[0] > 1 || (heif[0] === 1 && (heif[1] > 23 || (heif[1] === 23 && heif[2] >= 2)))));
    for (const format of ["jpeg", "png", "webp"]) {
      const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#abc" } })
        .toFormat(format).toBuffer();
      const output = await sharp(input, { limitInputPixels: 50_000_000, failOn: "error" })
        .rotate().toFormat(format).toBuffer();
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.format, format);
      assert.equal(metadata.width, 8);
      assert.equal(metadata.height, 8);
    }
  });

  it("stages byte-identical versioned worker modules from the locked package", () => {
    const temp = mkdtempSync(join(tmpdir(), "grainline-maplibre-assets-test-"));
    try {
      const staged = prepareMaplibreAssets(temp);
      assert.equal(staged.version, "6.4.1");
      const packageRoot = dirname(require.resolve("maplibre-gl/package.json"));
      for (const file of MAPLIBRE_WORKER_FILES) {
        const source = readFileSync(join(packageRoot, "dist", file));
        const destination = readFileSync(join(staged.destination, file));
        assert.equal(createHash("sha256").update(destination).digest("hex"), createHash("sha256").update(source).digest("hex"));
        assert.match(destination.toString(), /@license 3-Clause BSD/);
      }
      const worker = readFileSync(join(staged.destination, "maplibre-gl-worker.mjs"), "utf8");
      assert.match(worker, /\.\/maplibre-gl-shared\.mjs/);
    } finally {
      rmSync(temp, { recursive: true });
    }
  });

  it("routes all five map consumers through the same-origin worker configuration", () => {
    const source = readFileSync("src/lib/maplibreClient.ts", "utf8");
    assert.match(source, /setWorkerUrl\(`\/vendor\/maplibre\/\$\{getVersion\(\)\}\/maplibre-gl-worker\.mjs`\)/);
    for (const file of ["AllSellersMap", "SellersMap", "MapCard", "MaplibreMap", "LocationPicker"]) {
      const component = readFileSync(`src/components/${file}.tsx`, "utf8");
      assert.match(component, /import \* as maplibregl from "@\/lib\/maplibreClient"/);
      assert.match(component, /maplibreSupported\(maplibregl\)/);
      assert.match(component, /MapFallback/);
    }
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    assert.equal(pkg.scripts.predev, "node scripts/prepare-maplibre-assets.mjs");
    assert.match(pkg.scripts.build, /prepare-maplibre-assets\.mjs && next build/);
  });
});
