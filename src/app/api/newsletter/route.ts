// src/app/api/newsletter/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty */ }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() || null : null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    await prisma.newsletterSubscriber.upsert({
      where: { email },
      create: { email, name, active: true },
      update: { name: name ?? undefined, active: true },
    });

    return NextResponse.json({ subscribed: true });
  } catch (err) {
    console.error("POST /api/newsletter error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
