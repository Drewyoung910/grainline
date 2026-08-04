#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  runCaseActivationProof,
} from "./case-activation-postgres-proof.mjs";

const CASE_FORCE_PROOF_DATABASE_URL = "CASE_FORCE_PROOF_DATABASE_URL";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

export async function runCaseForceProof(env = process.env) {
  const databaseUrl = env[CASE_FORCE_PROOF_DATABASE_URL];
  return runCaseActivationProof(
    {
      ...env,
      CASE_ACTIVATION_PROOF_DATABASE_URL: databaseUrl,
    },
    {
      applicationName: "grainline-case-force-proof",
      forceExpected: true,
    },
  );
}

async function main() {
  const result = await runCaseForceProof();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `Case FORCE PostgreSQL proof failed closed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  });
}
