import { NextResponse } from "next/server";
import { isAccountAccessError } from "@/lib/ensureUser";

export function accountAccessErrorResponse(error: unknown) {
  if (!isAccountAccessError(error)) return null;
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status },
  );
}
