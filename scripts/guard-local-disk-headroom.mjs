import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MINIMUM_FREE_GIB = 10;

export function availableKilobytesFromDf(output) {
  const lines = String(output)
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("Unable to read local disk headroom.");
  }

  const fields = lines.at(-1).split(/\s+/);
  const availableKilobytes = Number(fields[3]);
  if (!Number.isFinite(availableKilobytes) || availableKilobytes < 0) {
    throw new Error("Unable to parse local disk headroom.");
  }
  return availableKilobytes;
}

export function freeGibFromKilobytes(availableKilobytes) {
  return availableKilobytes / 1024 / 1024;
}

export function assertLocalDiskHeadroom({
  availableKilobytes,
  minimumFreeGib = MINIMUM_FREE_GIB,
}) {
  const freeGib = freeGibFromKilobytes(availableKilobytes);
  if (freeGib < minimumFreeGib) {
    throw new Error(
      `Local disk headroom guard failed: ${freeGib.toFixed(1)} GiB free; `
      + `${minimumFreeGib} GiB required before dependency install, PostgreSQL proof, or Next build.`,
    );
  }
  return freeGib;
}

function main() {
  const output = execFileSync("df", ["-Pk", process.cwd()], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const freeGib = assertLocalDiskHeadroom({
    availableKilobytes: availableKilobytesFromDf(output),
  });
  process.stdout.write(
    `Local disk headroom guard passed: ${freeGib.toFixed(1)} GiB free.\n`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main();
}
