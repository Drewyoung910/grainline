import { NextRequest, NextResponse } from "next/server";
import { unsubscribeEmail, verifyUnsubscribeToken } from "@/lib/unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readEmailAndToken(req: NextRequest): Promise<{ email: string | null; token: string | null }> {
  const url = new URL(req.url);
  let email = url.searchParams.get("email");
  let token = url.searchParams.get("token");

  if ((!email || !token) && req.method === "POST") {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null) as { email?: unknown; token?: unknown } | null;
      email = email ?? (typeof body?.email === "string" ? body.email : null);
      token = token ?? (typeof body?.token === "string" ? body.token : null);
    } else {
      const formData = await req.formData().catch(() => null);
      email = email ?? (typeof formData?.get("email") === "string" ? String(formData.get("email")) : null);
      token = token ?? (typeof formData?.get("token") === "string" ? String(formData.get("token")) : null);
    }
  }

  return { email, token };
}

async function handle(req: NextRequest) {
  const { email, token } = await readEmailAndToken(req);
  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return NextResponse.json({ ok: false, error: "Invalid unsubscribe link" }, { status: 400 });
  }

  const result = await unsubscribeEmail(email);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Invalid email address" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
