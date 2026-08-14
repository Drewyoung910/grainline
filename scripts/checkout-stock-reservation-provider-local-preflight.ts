// CHECKOUT_STOCK_RESERVATION_PROVIDER_RUNNER_ONLY
import {
  parseCheckoutStockReservationProviderGateConfig,
  runCheckoutStockReservationProviderGate,
} from "../src/lib/checkoutStockReservationProviderGate.ts";

function sanitizedFailure(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown };
  const message = typeof candidate?.message === "string" ? candidate.message : "unknown failure";
  return {
    code: typeof candidate?.code === "string" && /^[A-Z0-9_]{2,16}$/.test(candidate.code)
      ? candidate.code
      : null,
    message: /postgres(?:ql)?:\/\/|password|credential|token|secret|\.neon\.tech/i.test(message)
      ? "redacted connection-bearing error"
      : message.slice(0, 160),
  };
}

async function main() {
  if (process.env.RLS_CONTEXT_GATE_CONFIRM !== "staging-only") {
    throw new Error("RLS_CONTEXT_GATE_CONFIRM=staging-only is required");
  }
  const slot = process.env.CHECKOUT_RESERVATION_PROVIDER_RUN_SLOT;
  if (slot !== "1" && slot !== "2") {
    throw new Error("CHECKOUT_RESERVATION_PROVIDER_RUN_SLOT must be 1 or 2");
  }
  const result = await runCheckoutStockReservationProviderGate(
    parseCheckoutStockReservationProviderGateConfig(Number(slot) as 1 | 2),
  );
  process.stdout.write(`${JSON.stringify({
    issueCount: result.issueCount,
    result,
    status: result.issueCount === 0 ? "passed" : "failed",
  })}\n`);
  if (result.issueCount > 0) process.exitCode = 1;
}

void main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ error: sanitizedFailure(error), status: "failed" })}\n`);
  process.exitCode = 1;
});
