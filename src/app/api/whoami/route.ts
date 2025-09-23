// src/app/api/whoami/route.ts
import { auth } from "@clerk/nextjs/server";
import { headers, cookies } from "next/headers";

export async function GET() {
  const h = await headers();
  const c = await cookies();

  const hasSessionCookie =
    Boolean(c.get("__session")) ||
    Boolean(h.get("cookie")?.includes("__session"));

  const { userId, sessionId } = await auth(); // <- await in Next 15

  return Response.json({ userId, sessionId, hasSessionCookie });
}





