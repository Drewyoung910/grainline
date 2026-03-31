// src/app/commission/[id]/page.tsx
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { CATEGORY_LABELS } from "@/lib/categories";
import GuildBadge from "@/components/GuildBadge";
import type { GuildLevelValue } from "@/components/GuildBadge";
import CommissionInterestButton from "../CommissionInterestButton";
import MarkStatusButtons from "./MarkStatusButtons";
import { ImageLightbox } from "@/components/ImageLightbox";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const req = await prisma.commissionRequest.findUnique({
    where: { id },
    select: { title: true },
  });
  if (!req) return {};
  return { title: req.title };
}

function timeAgo(dateStr: Date | string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default async function CommissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
      createdAt: true,
      buyerId: true,
      buyer: { select: { name: true, imageUrl: true } },
      interests: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          sellerProfile: {
            select: {
              id: true,
              displayName: true,
              avatarImageUrl: true,
              guildLevel: true,
              user: { select: { imageUrl: true } },
            },
          },
        },
      },
    },
  });

  if (!request) return notFound();

  // Auth
  const { userId } = await auth();
  let meId: string | null = null;
  let sellerProfileId: string | null = null;
  let alreadyInterested = false;

  if (userId) {
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, sellerProfile: { select: { id: true } } },
    });
    if (me) {
      meId = me.id;
      sellerProfileId = me.sellerProfile?.id ?? null;
      if (sellerProfileId) {
        const interest = await prisma.commissionInterest.findUnique({
          where: {
            commissionRequestId_sellerProfileId: {
              commissionRequestId: id,
              sellerProfileId,
            },
          },
        });
        alreadyInterested = !!interest;
      }
    }
  }

  const isOwner = meId === request.buyerId;
  const buyerName = request.buyer.name?.split(" ")[0] ?? "Buyer";

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      {/* Breadcrumb */}
      <div className="mb-5 text-sm text-neutral-500">
        <Link href="/commission" className="hover:underline">Commission Room</Link>
        <span className="mx-2">›</span>
        <span className="text-neutral-800">{request.title}</span>
      </div>

      {/* Status banner */}
      {request.status !== "OPEN" && (
        <div className="mb-5 bg-neutral-100 border border-neutral-200 text-neutral-600 text-sm px-4 py-3">
          This request is <strong>{request.status.toLowerCase().replace("_", " ")}</strong> and no longer accepting interest.
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-neutral-900 flex-1">{request.title}</h1>
        {sellerProfileId && !isOwner && request.status === "OPEN" && (
          <CommissionInterestButton
            requestId={request.id}
            sellerProfileId={sellerProfileId}
            initialInterested={alreadyInterested}
          />
        )}
        {!userId && request.status === "OPEN" && (
          <Link
            href={`/sign-in?redirect_url=/commission/${id}`}
            className="text-sm border border-neutral-900 px-3 py-1.5 hover:bg-neutral-900 hover:text-white transition-colors"
          >
            Sign in to Express Interest
          </Link>
        )}
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-neutral-500 mb-6 pb-6 border-b">
        {request.category && (
          <span className="border border-neutral-200 rounded-full px-3 py-0.5 text-xs">
            {CATEGORY_LABELS[request.category]}
          </span>
        )}
        {(request.budgetMinCents || request.budgetMaxCents) && (
          <span>
            Budget:{" "}
            {request.budgetMinCents && request.budgetMaxCents
              ? `$${(request.budgetMinCents / 100).toFixed(0)}–$${(request.budgetMaxCents / 100).toFixed(0)}`
              : request.budgetMinCents
              ? `From $${(request.budgetMinCents / 100).toFixed(0)}`
              : `Up to $${(request.budgetMaxCents! / 100).toFixed(0)}`}
          </span>
        )}
        {request.timeline && <span>Timeline: {request.timeline}</span>}
        <span>Posted {timeAgo(request.createdAt)}</span>
        <span>{request.interestedCount} maker{request.interestedCount !== 1 ? "s" : ""} interested</span>
      </div>

      {/* Description */}
      <section className="mb-6">
        <h2 className="font-semibold text-neutral-800 mb-2">Request Details</h2>
        <p className="text-sm text-neutral-700 whitespace-pre-wrap">{request.description}</p>
      </section>

      {/* Reference images */}
      {request.referenceImageUrls.length > 0 && (
        <section className="mb-6">
          <h2 className="font-semibold text-neutral-800 mb-3">Reference Images</h2>
          <ImageLightbox images={request.referenceImageUrls} />
        </section>
      )}

      {/* Buyer */}
      <section className="mb-6 pb-6 border-b">
        <h2 className="font-semibold text-neutral-800 mb-2">Posted by</h2>
        <div className="flex items-center gap-2">
          {request.buyer.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={request.buyer.imageUrl} alt={buyerName} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-neutral-200" />
          )}
          <span className="text-sm text-neutral-700">{buyerName}</span>
        </div>
      </section>

      {/* Interested makers */}
      {request.interests.length > 0 && (
        <section className="mb-6">
          <h2 className="font-semibold text-neutral-800 mb-3">
            {request.interests.length} Interested Maker{request.interests.length !== 1 ? "s" : ""}
          </h2>
          <div className="flex flex-wrap gap-3">
            {request.interests.map((interest) => {
              const sp = interest.sellerProfile;
              if (!sp) return null;
              const avatar = sp.avatarImageUrl ?? sp.user?.imageUrl;
              return (
                <Link
                  key={interest.id}
                  href={`/seller/${sp.id}`}
                  className="flex items-center gap-2 border border-neutral-200 rounded-full px-3 py-1.5 hover:bg-neutral-50 transition-colors"
                >
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt={sp.displayName} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-neutral-200" />
                  )}
                  <span className="text-sm text-neutral-800">{sp.displayName}</span>
                  <GuildBadge level={sp.guildLevel as GuildLevelValue} size={14} />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Owner actions */}
      {isOwner && request.status === "OPEN" && (
        <div className="flex gap-3 pt-4 border-t">
          <MarkStatusButtons requestId={request.id} />
        </div>
      )}
    </main>
  );
}
