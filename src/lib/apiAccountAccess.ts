import { accountAccessErrorPayload } from "@/lib/accountAccessError";
import { privateJson } from "./privateResponse.ts";

export function accountAccessErrorResponse(error: unknown) {
  const payload = accountAccessErrorPayload(error);
  if (!payload) return null;
  return privateJson(payload.body, { status: payload.status });
}
