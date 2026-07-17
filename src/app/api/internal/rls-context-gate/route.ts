import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  buildEvidencePayload,
  claimProviderRuntimeRunSlot,
  completeProviderRuntimeRunSlot,
  parseGateConfig,
  runAcceptanceGate,
} from "../../../../../scripts/rls-context-acceptance-gate.mjs";
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

function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}

type RunnerStage = "parse_config" | "claim_slot" | "run_gate" | "complete_slot";

function classifyRunnerError(error: unknown, stage: RunnerStage) {
  if (stage !== "parse_config") {
    return `${stage}_failed`;
  }

  const message = error instanceof Error ? error.message : "";
  const knownConfigurationErrors: Array<[string, string]> = [
    ["VERCEL_DEPLOYMENT_ID", "provider_deployment_id_invalid"],
    ["VERCEL_GIT_COMMIT_SHA", "provider_commit_sha_invalid"],
    ["VERCEL_REGION", "provider_region_invalid"],
    ["RLS_CONTEXT_GATE_DATABASE_URL", "runtime_database_url_invalid"],
    ["RLS_CONTEXT_GATE_LOCALITY_CONFIRM", "locality_confirmation_invalid"],
    ["RLS_CONTEXT_GATE_EXPECTED_DATABASE_ENDPOINT_ID", "database_endpoint_identity_invalid"],
    ["RLS_CONTEXT_GATE_EXPECTED_DATABASE_NAME", "database_name_invalid"],
    ["RLS_CONTEXT_GATE_EXPECTED_DATABASE_REGION", "database_region_invalid"],
    ["RLS_CONTEXT_GATE_EXPECTED_EXECUTION_REGION", "execution_region_invalid"],
    ["RLS_CONTEXT_GATE_RUNTIME_ROLE", "runtime_role_invalid"],
    ["RLS_CONTEXT_GATE_CONFIRM", "staging_confirmation_invalid"],
  ];

  return knownConfigurationErrors.find(([needle]) => message.includes(needle))?.[1]
    ?? "gate_configuration_invalid";
}

export async function POST(request: Request) {
  // This operational proof endpoint must never execute on a production deploy.
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

  const runId = process.env.RLS_CONTEXT_GATE_RUN_ID;
  if (!runId) {
    return privateJson({ error: "Runner is not configured" }, 503);
  }

  // Deliberately copy only runtime-safe gate inputs. Owner/admin URLs and setup
  // flags are never passed to this repeat-only Preview runner.
  const gateEnv: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
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
    VERCEL: process.env.VERCEL,
    VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    VERCEL_REGION: process.env.VERCEL_REGION,
  };

  let stage: RunnerStage = "parse_config";
  try {
    const config = parseGateConfig(gateEnv);
    stage = "claim_slot";
    const claimed = await claimProviderRuntimeRunSlot(config, {
      runId,
      runSlot: parsed.runSlot,
    });
    if (!claimed) {
      return privateJson({ error: "Run slot already consumed" }, 409);
    }
    const startedAt = new Date().toISOString();
    stage = "run_gate";
    const result = await runAcceptanceGate(config);
    const finishedAt = new Date().toISOString();
    const status = result.issues.length > 0 ? "failed" : "passed";
    const evidence = buildEvidencePayload(
      config,
      result,
      { finishedAt, startedAt, status },
      gateEnv,
    ) as Record<string, unknown>;
    stage = "complete_slot";
    await completeProviderRuntimeRunSlot(config, {
      runId,
      runSlot: parsed.runSlot,
      succeeded: result.issues.length === 0,
    });
    return privateJson({
      ...evidence,
      runner: {
        runIdSha256: digest(runId).toString("hex"),
        runSlot: parsed.runSlot,
      },
    }, result.issues.length > 0 ? 422 : 200);
  } catch (error) {
    // Never log or reflect the raw error: connection failures may contain host
    // or role details. Stage + whitelisted code are sufficient to diagnose the
    // temporary runner without weakening evidence sanitization.
    const code = classifyRunnerError(error, stage);
    console.error("RLS context gate failed before sanitized evidence", { code, stage });
    return privateJson({
      code,
      error: "RLS context gate failed before sanitized evidence was available",
      stage,
    }, 500);
  }
}
