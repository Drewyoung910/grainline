import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { adminEmailRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const Schema = z.object({
  userId: z.string().min(1),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});

export async function POST(request: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true, role: true },
  });
  if (!admin || admin.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — ADMIN only" }, { status: 403 });
  }

  const rl = await safeRateLimit(adminEmailRatelimit, admin.id);
  if (!rl.success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  let body;
  try {
    body = Schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const recipient = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { email: true, name: true },
  });
  if (!recipient?.email) {
    return NextResponse.json({ error: "User not found or no email" }, { status: 404 });
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn("[admin email] RESEND_API_KEY not set — skipping send");
    return NextResponse.json({ ok: true, skipped: true });
  }

  const escapedBody = body.body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  const htmlBody = `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:600px;margin:0 auto;background:#FAFAF8;padding:0;">
      <div style="background:#1C1C1A;padding:18px 28px;">
        <span style="color:#F2E6D8;font-size:20px;font-weight:bold;letter-spacing:0.05em;">GRAINLINE</span>
      </div>
      <div style="padding:32px 28px;">
        <p style="color:#3D3D3A;font-size:15px;line-height:1.7;margin:0;">${escapedBody}</p>
      </div>
      <div style="padding:16px 28px;border-top:1px solid #E5E2DC;">
        <p style="color:#9CA3AF;font-size:12px;margin:0;">This message was sent by the Grainline team · <a href="https://thegrainline.com" style="color:#9CA3AF;">thegrainline.com</a></p>
      </div>
    </div>
  `;

  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Grainline <hello@thegrainline.com>",
    to: recipient.email,
    subject: body.subject,
    html: htmlBody,
  });

  return NextResponse.json({ ok: true });
}
