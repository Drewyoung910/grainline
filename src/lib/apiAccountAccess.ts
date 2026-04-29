import { NextResponse } from "next/server";
import { accountAccessErrorPayload } from "@/lib/accountAccessError";

export function accountAccessErrorResponse(error: unknown) {
  const payload = accountAccessErrorPayload(error);
  if (!payload) return null;
  return NextResponse.json(payload.body, { status: payload.status });
}
