import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

import { homepageMapFrameClassName } from "../src/lib/homepageMapLayout.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

async function compiledTailwindCss(classNames) {
  const source = `@import "tailwindcss";\n@source inline("${classNames}");`;
  const result = await postcss([tailwindcss()]).process(source, {
    from: path.join(projectRoot, "tests", "homepage-map-layout.css"),
  });
  return result.css;
}

async function measuredMapHeight({ width, height, compact }) {
  const chrome = chromeExecutable();
  assert.ok(chrome, "Chrome or Chromium is required for the homepage layout regression test");

  const parentClasses = "flex min-w-0 flex-col lg:flex-row lg:items-center gap-5 lg:gap-8";
  const copyClasses = "min-w-0 lg:w-[34%] lg:pb-8";
  const frameClasses = homepageMapFrameClassName(compact);
  const css = await compiledTailwindCss(`${parentClasses} ${copyClasses} ${frameClasses}`);
  const directory = mkdtempSync(path.join(tmpdir(), "grainline-homepage-map-"));
  const fixturePath = path.join(directory, "index.html");

  try {
    writeFileSync(
      fixturePath,
      `<!doctype html>
<html>
  <head><meta charset="utf-8"><style>${css}</style></head>
  <body>
    <main class="${parentClasses}">
      <section class="${copyClasses}"><h2>Find Shops Near You</h2><p>Supporting copy</p></section>
      <div id="map-frame" class="${frameClasses}"></div>
    </main>
    <script>
      document.body.dataset.viewportWidth = String(window.innerWidth);
      document.body.dataset.mapHeight = String(
        document.getElementById("map-frame").getBoundingClientRect().height
      );
    </script>
  </body>
</html>`,
      "utf8"
    );

    const result = spawnSync(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-default-browser-check",
        "--no-first-run",
        `--user-data-dir=${path.join(directory, "chrome-profile")}`,
        `--window-size=${width},${height}`,
        "--dump-dom",
        `file://${fixturePath}`,
      ],
      { encoding: "utf8", timeout: 30_000 }
    );

    assert.equal(
      result.status,
      0,
      result.error?.message || result.stderr || "headless Chrome failed"
    );
    const viewportWidth = Number(result.stdout.match(/data-viewport-width="([\d.]+)"/)?.[1]);
    const mapHeight = Number(result.stdout.match(/data-map-height="([\d.]+)"/)?.[1]);
    assert.ok(Number.isFinite(viewportWidth), "fixture did not report its viewport width");
    assert.ok(Number.isFinite(mapHeight), "fixture did not report the map height");
    return { viewportWidth, mapHeight };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("homepage maker map layout", () => {
  it("keeps the compact map visible at phone, tablet, and desktop widths", async () => {
    const cases = [
      { width: 390, height: 844, expectedHeight: 300 },
      { width: 768, height: 1024, expectedHeight: 320 },
      { width: 1440, height: 900, expectedHeight: 340 },
    ];

    for (const testCase of cases) {
      const actual = await measuredMapHeight({ ...testCase, compact: true });
      assert.equal(
        actual.mapHeight,
        testCase.expectedHeight,
        `map height at ${actual.viewportWidth}px viewport`
      );
    }
  });
});
