// src/app/api/whoami/route.ts
import { auth } from "@clerk/nextjs/server";
import { headers, cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const h = await headers();
  const c = await cookies();

  const hasSessionCookie =
    Boolean(c.get("__session")) ||
    Boolean(h.get("cookie")?.includes("__session"));

  const { userId } = await auth(); // <- await in Next 15

  return NextResponse.json({ userId, hasSessionCookie });
}




