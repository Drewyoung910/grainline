export type JsonFieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function parseJsonArrayField(value: FormDataEntryValue | null): JsonFieldResult<unknown[]> {
  if (typeof value !== "string" || value.trim() === "") return { ok: true, value: [] };

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return { ok: false, error: "Expected JSON array" };
    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function parseJsonObjectField(value: string | null | undefined): JsonFieldResult<Record<string, unknown> | null> {
  if (typeof value !== "string" || value.trim() === "") return { ok: true, value: null };

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Expected JSON object" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
