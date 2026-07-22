// NOTIFICATION_PROVIDER_PROOF_LOCAL_PREFLIGHT_ONLY
import { prisma } from "@/lib/db";
import {
  parseNotificationProviderGateConfig,
  runNotificationProviderGate,
} from "@/lib/notificationRlsProviderGate";

function isPerformanceThresholdIssue(issue: string) {
  return issue.includes(" exceeded the fixed ");
}

function sanitizedFailure(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; name?: unknown };
  const raw = typeof candidate?.message === "string" ? candidate.message : String(error);
  return {
    code: typeof candidate?.code === "string" ? candidate.code.slice(0, 40) : null,
    message: /postgres(?:ql)?:\/\//i.test(raw)
      ? "redacted connection-bearing error"
      : raw.slice(0, 1_000),
    name: typeof candidate?.name === "string" ? candidate.name.slice(0, 80) : null,
  };
}

async function main() {
  try {
    const result = await runNotificationProviderGate(
      parseNotificationProviderGateConfig(1, {
        NOTIFICATION_RLS_PROVIDER_BURST_CONCURRENCY: "2",
        NOTIFICATION_RLS_PROVIDER_REQUESTS: "20",
        NOTIFICATION_RLS_PROVIDER_TARGET_CONCURRENCY: "2",
        NOTIFICATION_RLS_PROVIDER_WARMUP_REQUESTS: "5",
      }),
    );
    const workloads = Object.values(result.metrics).flatMap((pair) => [
      pair.baseline,
      pair.candidate,
    ]);
    const nonPerformanceIssues = result.issues.filter(
      (issue) => !isPerformanceThresholdIssue(issue),
    );
    const passed = result.catalog.runtimeRole === "grainline_app_runtime"
      && result.catalog.rls === true
      && result.catalog.forceRls === false
      && result.correctness.bellRows === 4
      && result.correctness.exportRows === 4
      && result.correctness.foreignRows === 1
      && result.correctness.initialUnread === 3
      && result.correctness.page === 2
      && result.correctness.serviceReplayStable === true
      && result.correctness.statementLocalContextReset === true
      && workloads.every((workload) => workload.errorCount === 0)
      && nonPerformanceIssues.length === 0;
    console.log(JSON.stringify({
      catalog: result.catalog,
      correctness: result.correctness,
      ignoredPerformanceIssueCount:
        result.issues.length - nonPerformanceIssues.length,
      metricErrorCount: workloads.reduce(
        (count, workload) => count + workload.errorCount,
        0,
      ),
      nonPerformanceIssues,
      status: passed ? "passed" : "failed",
    }));
    if (!passed) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ error: sanitizedFailure(error), status: "failed" }));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
