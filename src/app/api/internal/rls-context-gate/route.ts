import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  claimProviderRuntimeRunSlot,
  completeProviderRuntimeRunSlot,
  parseGateConfig,
} from "../../../../../scripts/rls-context-acceptance-gate.mjs";
import {
  parseNotificationProviderGateConfig,
  runNotificationProviderGate,
} from "@/lib/notificationRlsProviderGate";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";

export const runtime = "nodejs";
export const maxDuration = 300;

const BODY_MAX_BYTES = 4 * 1024;
const RequestSchema = z.object({
  runSlot: z.union([z.literal(1), z.literal(2)]),
  token: z.string().min(32).max(256),
}).strict();

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isAuthorized(provided: string) {
  const expected = process.env.RLS_CONTEXT_GATE_TRIGGER_SECRET;
  return Boolean(expected) && timingSafeEqual(digest(provided), digest(expected!));
}

function providerRunIsPinned() {
  const allowedCommitSha = process.env.RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA;
  return Boolean(allowedCommitSha)
    && allowedCommitSha === process.env.VERCEL_GIT_COMMIT_SHA;
}

function providerDatabaseUrlsMatch() {
  const applicationUrl = process.env.DATABASE_URL;
  const gateUrl = process.env.RLS_CONTEXT_GATE_DATABASE_URL;
  return Boolean(applicationUrl && gateUrl)
    && timingSafeEqual(digest(applicationUrl!), digest(gateUrl!));
}

function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return new Response("Not found", { status: 404 });
  }

  let parsed: z.infer<typeof RequestSchema>;
  try {
    parsed = RequestSchema.parse(await readBoundedJson(request, BODY_MAX_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, 413);
    }
    if (isInvalidJsonBodyError(error) || error instanceof z.ZodError) {
      return privateJson({ error: "Invalid request" }, 400);
    }
    return privateJson({ error: "Invalid request" }, 400);
  }

  if (!isAuthorized(parsed.token)) {
    return privateJson({ error: "Unauthorized" }, 401);
  }
  if (!providerRunIsPinned()) {
    return privateJson({ error: "Runner is not pinned to this commit" }, 403);
  }
  if (!providerDatabaseUrlsMatch()) {
    return privateJson({ error: "Runner database configuration does not match the application" }, 503);
  }

  const runId = process.env.RLS_CONTEXT_GATE_RUN_ID;
  if (!runId) {
    return privateJson({ error: "Runner is not configured" }, 503);
  }

  // Copy only runtime-safe repeat inputs. Owner/admin URLs and setup,
  // rollback, teardown, or evidence-path flags never enter the Preview runner.
  const gateEnv: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: process.env.PGOPTIONS,
    RLS_CONTEXT_GATE_BURST_CONCURRENCY: process.env.RLS_CONTEXT_GATE_BURST_CONCURRENCY,
    RLS_CONTEXT_GATE_CONFIRM: process.env.RLS_CONTEXT_GATE_CONFIRM,
    RLS_CONTEXT_GATE_CONNECTION_TIMEOUT_MS: process.env.RLS_CONTEXT_GATE_CONNECTION_TIMEOUT_MS,
    RLS_CONTEXT_GATE_DATABASE_URL: process.env.RLS_CONTEXT_GATE_DATABASE_URL,
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID: process.env.RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID,
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME: process.env.RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME,
    RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION: process.env.RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION,
    RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION: process.env.RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION,
    RLS_CONTEXT_GATE_LOCALITY_CONFIRM: process.env.RLS_CONTEXT_GATE_LOCALITY_CONFIRM,
    RLS_CONTEXT_GATE_POOL_SIZE: process.env.RLS_CONTEXT_GATE_POOL_SIZE,
    RLS_CONTEXT_GATE_QUERY_TIMEOUT_MS: process.env.RLS_CONTEXT_GATE_QUERY_TIMEOUT_MS,
    RLS_CONTEXT_GATE_REQUESTS: process.env.RLS_CONTEXT_GATE_REQUESTS,
    RLS_CONTEXT_GATE_RUNTIME_ROLE: process.env.RLS_CONTEXT_GATE_RUNTIME_ROLE,
    RLS_CONTEXT_GATE_SCHEMA: process.env.RLS_CONTEXT_GATE_SCHEMA,
    RLS_CONTEXT_GATE_STATEMENT_TIMEOUT_MS: process.env.RLS_CONTEXT_GATE_STATEMENT_TIMEOUT_MS,
    RLS_CONTEXT_GATE_TABLE: process.env.RLS_CONTEXT_GATE_TABLE,
    RLS_CONTEXT_GATE_TARGET_CONCURRENCY: process.env.RLS_CONTEXT_GATE_TARGET_CONCURRENCY,
    RLS_CONTEXT_GATE_TURNOVER_REQUESTS: process.env.RLS_CONTEXT_GATE_TURNOVER_REQUESTS,
    RLS_CONTEXT_GATE_TX_TIMEOUT_MS: process.env.RLS_CONTEXT_GATE_TX_TIMEOUT_MS,
    RLS_CONTEXT_GATE_WARMUP_REQUESTS: process.env.RLS_CONTEXT_GATE_WARMUP_REQUESTS,
    NOTIFICATION_RLS_PROVIDER_BURST_CONCURRENCY:
      process.env.NOTIFICATION_RLS_PROVIDER_BURST_CONCURRENCY,
    NOTIFICATION_RLS_PROVIDER_REQUESTS: process.env.NOTIFICATION_RLS_PROVIDER_REQUESTS,
    NOTIFICATION_RLS_PROVIDER_TARGET_CONCURRENCY:
      process.env.NOTIFICATION_RLS_PROVIDER_TARGET_CONCURRENCY,
    NOTIFICATION_RLS_PROVIDER_WARMUP_REQUESTS:
      process.env.NOTIFICATION_RLS_PROVIDER_WARMUP_REQUESTS,
    VERCEL: process.env.VERCEL,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_REGION: process.env.VERCEL_REGION,
  };

  let failureStage: "configuration" | "claim" | "notification_gate" | "completion" =
    "configuration";
  try {
    const config = parseGateConfig(gateEnv);
    failureStage = "claim";
    const claimed = await claimProviderRuntimeRunSlot(config, {
      runId,
      runSlot: parsed.runSlot,
    });
    if (!claimed) {
      return privateJson({ error: "Run slot already consumed" }, 409);
    }
    const startedAt = new Date().toISOString();
    const notificationConfig = parseNotificationProviderGateConfig(parsed.runSlot, gateEnv);
    failureStage = "notification_gate";
    const result = await runNotificationProviderGate(notificationConfig);
    const finishedAt = new Date().toISOString();
    const status = result.issueCount > 0 ? "failed" : "passed";
    const databaseHost = process.env.DATABASE_URL
      ? new URL(process.env.DATABASE_URL).hostname
      : null;
    const evidence = {
      config: {
        burstConcurrency: notificationConfig.burstConcurrency,
        measuredRequests: notificationConfig.requests,
        prismaPoolSize: 10,
        targetConcurrency: notificationConfig.targetConcurrency,
        warmupRequests: notificationConfig.warmupRequests,
      },
      database: {
        databaseHost,
        expectedDatabaseEndpointId:
          process.env.RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID,
        expectedDatabaseName: process.env.RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME,
        runtimeRole: result.catalog.runtimeRole,
      },
      finishedAt,
      locality: {
        acceptanceEligible: false,
        observedDatabaseRegion: process.env.RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION,
        observedExecutionRegion: process.env.VERCEL_REGION,
        providerRuntimeMetadataPresent: Boolean(
          process.env.VERCEL_DEPLOYMENT_ID
          && process.env.VERCEL_GIT_COMMIT_SHA
          && process.env.VERCEL_REGION
        ),
        runtimeEvidenceCandidate: true,
      },
      proofMode: "provider-runtime-real-notification-candidate",
      result,
      run: {
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
        deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
        status: result.issueCount === 0 ? "runtime_candidate_passed" : "runtime_candidate_failed",
      },
      startedAt,
      status,
    } satisfies Record<string, unknown>;
    failureStage = "completion";
    await completeProviderRuntimeRunSlot(config, {
      evidence,
      runId,
      runSlot: parsed.runSlot,
      succeeded: result.issueCount === 0,
    });
    return privateJson({
      ...evidence,
      runner: {
        nodeVersion: process.version,
        runIdSha256: digest(runId).toString("hex"),
        runSlot: parsed.runSlot,
      },
    }, result.issueCount > 0 ? 422 : 200);
  } catch {
    return privateJson({
      error: "RLS context gate failed before sanitized evidence was available",
      stage: failureStage,
    }, 500);
  }
}
