import { ADMIN_PIN_COOKIE_NAME, verifyAdminPinCookieValue } from "@/lib/adminPin";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { privateJson } from "@/lib/privateResponse";

function requestCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = cookie.trim().split("=");
    if (rawName === name) return rawValueParts.join("=");
  }
  return undefined;
}

export async function requireStaffAdminPinForApi(
  request: Request,
  userId: string,
  sessionId: string | null | undefined,
) {
  const pinVerified = await verifyAdminPinCookieValue(
    requestCookieValue(request, ADMIN_PIN_COOKIE_NAME),
    userId,
    sessionId,
  );
  if (pinVerified) return null;
  return privateJson({ error: "Admin PIN required" }, { status: HTTP_STATUS.FORBIDDEN });
}
