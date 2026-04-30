function retryAfterCopy(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return "Try again in a moment.";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  const hours = Math.ceil(minutes / 60);
  return `Try again in ${hours} hour${hours === 1 ? "" : "s"}.`;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  let body: { error?: unknown; message?: unknown; retryAfterSeconds?: unknown } | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  const message =
    stringField(body?.error) ??
    stringField(body?.message) ??
    stringField(text) ??
    fallback;

  if (response.status !== 429 || /\btry again\b/i.test(message)) {
    return message;
  }

  const retryAfterSeconds = Number(body?.retryAfterSeconds ?? response.headers.get("Retry-After"));
  const retryCopy = retryAfterCopy(retryAfterSeconds);
  return retryCopy ? `${message} ${retryCopy}` : message;
}
