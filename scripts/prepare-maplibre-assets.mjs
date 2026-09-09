import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
export const MAPLIBRE_WORKER_FILES = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
];

// MapLibre 6 resolves its worker relative to its original module URL. Next
// rebundles that module, so publish the two locked worker modules together.
// Keep the upstream license headers; never fetch a runtime worker from a CDN.
export function prepareMaplibreAssets(publicRoot = resolve("public")) {
  const packagePath = require.resolve("maplibre-gl/package.json");
  const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
  if (!/^6\.\d+\.\d+$/.test(version)) {
    throw new Error("Review MapLibre worker packaging before changing its release line");
  }
  const destination = join(publicRoot, "vendor", "maplibre", version);
  mkdirSync(destination, { recursive: true });
  for (const file of MAPLIBRE_WORKER_FILES) {
    copyFileSync(join(dirname(packagePath), "dist", file), join(destination, file));
  }
  return { version, destination };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { version } = prepareMaplibreAssets();
  console.log(`Prepared local MapLibre ${version} worker modules.`);
}
