// Same-process execution lifetime. Never accepts a serialized "admitted" flag.
// The trusted worker owns verify/onLost. Polling is bounded observation, not an
// atomic distributed lease or protection against a compromised host.
import assert from "node:assert/strict";

export function createOrderExecutionWatch({ verify, onLost, intervalMs = 1000, deadlineMs = 30000 }) {
  assert.equal(typeof verify, "function"); assert.equal(typeof onLost, "function");
  assert.ok(Number.isInteger(intervalMs) && intervalMs > 0 && intervalMs <= 1000);
  assert.ok(Number.isInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 30000);
  let pending, timer, closed = false, lost = false;
  const failure = () => new Error("Order execution admission lost; preserve attempt");
  function poison() {
    if (lost || closed) return;
    lost = true; clearInterval(timer);
    try { onLost(); } catch { /* Loss remains terminal even if cleanup fails. */ }
  }
  const live = () => { if (lost || closed) throw failure(); };
  const check = () => {
    try { live(); } catch { return Promise.reject(failure()); }
    if (!pending) {
      let timeout;
      const expired = new Promise((_, reject) => { timeout = setTimeout(() => { poison(); reject(failure()); }, deadlineMs); });
      pending = Promise.race([Promise.resolve().then(verify), expired])
        .then(() => { live(); })
        .catch(() => { poison(); throw failure(); })
        .finally(() => { clearTimeout(timeout); pending = undefined; });
    }
    return pending;
  };
  timer = setInterval(() => { check().catch(() => {}); }, intervalMs);
  return Object.freeze({ check, assertLive: live,
    async close() {
      clearInterval(timer);
      // Joining an existing observation prevents a late rejection from being
      // silently discarded after the owning executor reports success.
      try { if (pending) await pending; live(); } finally { closed = true; }
    },
  });
}
