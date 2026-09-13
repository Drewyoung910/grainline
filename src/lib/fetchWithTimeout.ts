export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let removeCallerAbortListener: (() => void) | null = null;

  if (init.signal) {
    if (init.signal.aborted) {
      controller.abort(init.signal.reason);
    } else {
      const abortFromCaller = () => controller.abort(init.signal?.reason);
      init.signal.addEventListener("abort", abortFromCaller, { once: true });
      removeCallerAbortListener = () => init.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    removeCallerAbortListener?.();
  }
}
