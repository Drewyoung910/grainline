// src/app/api/commission/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { CommissionStatus } from "@prisma/client";
import { createNotification } from "@/lib/notifications";
import { commissionIsExpired } from "@/lib/commissionExpiry";
import { z } from "zod";

const CommissionPatchSchema = z.object({
  status: z.enum(["FULFILLED", "CLOSED"]),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const request = await prisma.commissionRequest.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      timeline: true,
      referenceImageUrls: true,
      status: true,
      interestedCount: true,
      expiresAt: true,
      createdAt: true,
      buyerId: true,
      buyer: { select: { name: true, imageUrl: true, banned: true, deletedAt: true } },
      interests: {
        where: {
          sellerProfile: {
            chargesEnabled: true,
            vacationMode: false,
            user: { banned: false, deletedAt: null },
          },
        },
        select: {
          id: true,
          createdAt: true,
          sellerProfile: {
            select: {
              id: true,
              displayName: true,
              avatarImageUrl: true,
              guildLevel: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.buyer.banned || request.buyer.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (commissionIsExpired(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ...request,
    buyer: { name: request.buyer.name, imageUrl: request.buyer.imageUrl },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true },
  });
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 401 });
  if (me.banned) return NextResponse.json({ error: "Account is suspended" }, { status: 403 });

  const request = await prisma.commissionRequest.findUnique({
    where: { id },
    select: {
      buyerId: true,
      status: true,
      expiresAt: true,
      title: true,
      interests: {
        select: {
          sellerProfile: { select: { userId: true } },
        },
      },
    },
  });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.buyerId !== me.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (commissionIsExpired(request)) {
    return NextResponse.json({ error: "Commission request has expired" }, { status: 400 });
  }

  let patchParsed;
  try {
    patchParsed = CommissionPatchSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { status } = patchParsed;
  if ((status as CommissionStatus) === CommissionStatus.FULFILLED && request.interests.length === 0) {
    return NextResponse.json({ error: "A commission request needs at least one interested maker before it can be fulfilled." }, { status: 400 });
  }

  const updated = await prisma.commissionRequest.update({
    where: { id },
    data: { status: status as CommissionStatus },
    select: { id: true, status: true },
  });

  // Notify interested sellers
  const isFulfilled = (status as CommissionStatus) === CommissionStatus.FULFILLED;
  after(async () => {
    try {
      await Promise.all(
        request.interests.map((interest) =>
          createNotification({
            userId: interest.sellerProfile.userId,
            type: "COMMISSION_INTEREST",
            title: isFulfilled ? "Commission request fulfilled" : "Commission request closed",
            body: isFulfilled
              ? `The request "${request.title}" has been fulfilled. Thanks for your interest!`
              : `The request "${request.title}" has been closed by the buyer.`,
            link: isFulfilled ? `/commission/${id}` : `/commission`,
          })
        )
      );
    } catch { /* non-fatal */ }
  });

  return NextResponse.json(updated);
}
