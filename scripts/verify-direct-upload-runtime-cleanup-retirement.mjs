#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function regularSource(root, path) {
  const absolute = `${root}/${path}`;
  if (!existsSync(absolute)) {
    throw new Error(`required source is missing: ${path}`);
  }
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`required source must be a regular non-symlink file: ${path}`);
  }
  return readFileSync(absolute, "utf8");
}

export function verifyDirectUploadRuntimeCleanupRetirement(
  root = process.cwd(),
) {
  const route =
    `${root}/src/app/api/cron/direct-upload-cleanup/route.ts`;
  if (existsSync(route)) {
    throw new Error("ordinary-runtime DirectUpload cleanup route still exists");
  }

  const vercel = JSON.parse(regularSource(root, "vercel.json"));
  if (
    !Array.isArray(vercel.crons)
    || vercel.crons.some(
      (entry) => entry?.path === "/api/cron/direct-upload-cleanup",
    )
  ) {
    throw new Error("Vercel DirectUpload cleanup schedule is not retired");
  }

  const lifecycle = regularSource(root, "src/lib/directUploadLifecycle.ts");
  if (
    /processExpiredDirectUploadBatch/.test(lifecycle)
    || /deleteR2ObjectByStorageClass/.test(lifecycle)
    || /grainline_direct_upload_cleanup_(?:lease|complete|fail)/.test(lifecycle)
  ) {
    throw new Error("ordinary runtime retains DirectUpload cleanup authority");
  }

  const workflow = regularSource(
    root,
    ".github/workflows/direct-upload-cleanup.yml",
  );
  if (
    !/workflow_dispatch:/.test(workflow)
    || /^\s*schedule:/m.test(workflow)
    || !/environment: Production DirectUpload Cleanup/.test(workflow)
    || /PRODUCTION_MIGRATION_DIRECT_URL/.test(workflow)
    || /^\s+DATABASE_URL:/m.test(workflow)
  ) {
    throw new Error("isolated DirectUpload cleanup workflow boundary drifted");
  }

  const worker = regularSource(root, "scripts/direct-upload-cleanup-worker.mjs");
  for (const required of [
    "grainline_direct_upload_cleanup_lease",
    "grainline_direct_upload_cleanup_complete",
    "grainline_direct_upload_cleanup_fail",
    "new DeleteObjectCommand(",
  ]) {
    if (!worker.includes(required)) {
      throw new Error("isolated DirectUpload cleanup worker is incomplete");
    }
  }

  return Object.freeze({
    status: "passed",
    vercelScheduleAbsent: true,
    runtimeRouteAbsent: true,
    runtimeCleanupAuthorityAbsent: true,
    isolatedWorkerRetained: true,
    githubScheduleEnabled: false,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      `${JSON.stringify(verifyDirectUploadRuntimeCleanupRetirement())}\n`,
    );
  } catch {
    process.stderr.write(
      "DirectUpload runtime cleanup retirement verification failed closed.\n",
    );
    process.exitCode = 1;
  }
}
