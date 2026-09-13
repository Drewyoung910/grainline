export const DEFAULT_RESPONSE_TEXT_TIMEOUT_MS = 2_000;
export const DEFAULT_RESPONSE_TEXT_MAX_BYTES = 4_096;

type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<ReadResult<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false }), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      () => {
        clearTimeout(timer);
        resolve({ ok: false });
      },
    );
  });
}

export async function readResponseTextWithTimeout(
  response: Response,
  {
    timeoutMs = DEFAULT_RESPONSE_TEXT_TIMEOUT_MS,
    maxBytes = DEFAULT_RESPONSE_TEXT_MAX_BYTES,
  }: { timeoutMs?: number; maxBytes?: number } = {},
) {
  if (!response.body) {
    const result = await withTimeout(response.text(), timeoutMs);
    if (!result.ok) return "[response body read timed out]";
    return result.value.slice(0, maxBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const deadline = Date.now() + Math.max(1, timeoutMs);
  let receivedBytes = 0;
  let timedOut = false;
  let truncated = false;

  try {
    while (receivedBytes < maxBytes) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const result = await withTimeout(reader.read(), remainingMs);
      if (!result.ok) {
        timedOut = true;
        await reader.cancel("response body read timed out").catch(() => {});
        break;
      }
      if (result.value.done) break;

      const value = result.value.value;
      if (!value) continue;
      const allowedBytes = Math.min(value.byteLength, maxBytes - receivedBytes);
      chunks.push(decoder.decode(value.slice(0, allowedBytes), { stream: true }));
      receivedBytes += allowedBytes;
      if (allowedBytes < value.byteLength) {
        truncated = true;
        await reader.cancel("response body truncated").catch(() => {});
        break;
      }
    }
    chunks.push(decoder.decode());
  } catch {
    await reader.cancel("response body unavailable").catch(() => {});
    return "[response body unavailable]";
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The lock can already be released after cancellation in some runtimes.
    }
  }

  let text = chunks.join("");
  if (truncated) text += "\n[response body truncated]";
  if (timedOut) text += "\n[response body read timed out]";
  return text || (timedOut ? "[response body read timed out]" : "");
}
