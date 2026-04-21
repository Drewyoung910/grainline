// src/app/dashboard/listings/new/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { sendFirstListingCongrats, sendNewListingFromFollowedMakerEmail } from "@/lib/email";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { listingCreateRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";
import ImagesUploader from "@/components/ImagesUploader";
import TagsInput from "@/components/TagsInput";
import ListingTypeFields from "@/components/ListingTypeFields";
import type { Category, ListingType } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";

function normalizeTag(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "").slice(0, 24);
}

// unit converters
const inToCm = (v: number) => Math.round((v * 2.54 + Number.EPSILON) * 100) / 100;
const lbToG  = (v: number) => Math.round(v * 453.59237);

async function createListing(formData: FormData) {
  "use server";

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/listings/new");

  // 1. Read saveAsDraft FIRST — before any other logic
  const saveAsDraft = formData.get("saveAsDraft") === "true";

  const { success: rlOk } = await safeRateLimit(listingCreateRatelimit, userId);
  if (!rlOk) throw new Error("You can create up to 20 listings per day. Try again tomorrow.");

  const { seller } = await ensureSeller();

  // 2. Check chargesEnabled for publish (not for draft)
  if (!saveAsDraft && !seller.chargesEnabled) {
    redirect("/dashboard/listings/new?error=stripe");
  }

  const title = sanitizeText(String(formData.get("title") ?? "").trim());
  const description = sanitizeRichText(String(formData.get("description") ?? "").trim());
  const priceStr = String(formData.get("price") ?? "0");
  const priceCents = Math.round(parseFloat(priceStr) * 100);

  // Photos
  let imageUrls: string[] = [];
  const json = formData.get("imageUrlsJson");
  if (typeof json === "string" && json.length) {
    try { imageUrls = (JSON.parse(json) as string[]).filter(Boolean); } catch {}
  }
  if (imageUrls.length === 0) {
    imageUrls = formData.getAll("imageUrls").map(String).filter(Boolean);
  }
  imageUrls = imageUrls.slice(0, 8);

  // Tags
  let tags: string[] = [];
  const tagsJson = formData.get("tagsJson");
  if (typeof tagsJson === "string" && tagsJson.length) {
    try {
      const arr = JSON.parse(tagsJson);
      if (Array.isArray(arr)) {
        const set = new Set<string>();
        for (const raw of arr) {
          if (typeof raw !== "string") continue;
          const t = normalizeTag(raw);
          if (!t) continue;
          if (set.size >= 10) break;
          set.add(t);
        }
        tags = Array.from(set);
      }
    } catch {}
  }

  // Packaged dims/weight (entered in inches & pounds; stored as cm & grams)
  const lenIn = Number(String(formData.get("pkgLengthIn") ?? "").trim());
  const widIn = Number(String(formData.get("pkgWidthIn") ?? "").trim());
  const hgtIn = Number(String(formData.get("pkgHeightIn") ?? "").trim());
  const wtLb  = Number(String(formData.get("pkgWeightLb") ?? "").trim());

  const packagedLengthCm  = Number.isFinite(lenIn) && lenIn > 0 ? inToCm(lenIn) : null;
  const packagedWidthCm   = Number.isFinite(widIn) && widIn > 0 ? inToCm(widIn) : null;
  const packagedHeightCm  = Number.isFinite(hgtIn) && hgtIn > 0 ? inToCm(hgtIn) : null;
  const packagedWeightGrams = Number.isFinite(wtLb) && wtLb > 0 ? lbToG(wtLb) : null;

  // Category
  const categoryRaw = String(formData.get("category") ?? "").trim().toUpperCase();
  const category: Category | null = CATEGORY_VALUES.includes(categoryRaw) ? (categoryRaw as Category) : null;

  // Listing type & inventory
  const listingTypeRaw = String(formData.get("listingType") ?? "MADE_TO_ORDER");
  const listingType: ListingType = listingTypeRaw === "IN_STOCK" ? "IN_STOCK" : "MADE_TO_ORDER";
  const stockQuantityRaw = parseInt(String(formData.get("stockQuantity") ?? ""), 10);
  const stockQuantity = listingType === "IN_STOCK" && Number.isFinite(stockQuantityRaw) && stockQuantityRaw > 0
    ? stockQuantityRaw : null;
  const shipsWithinDaysRaw = parseInt(String(formData.get("shipsWithinDays") ?? ""), 10);
  const shipsWithinDays = listingType === "IN_STOCK" && Number.isFinite(shipsWithinDaysRaw) && shipsWithinDaysRaw > 0
    ? shipsWithinDaysRaw : null;

  // Processing time (only for MADE_TO_ORDER)
  const minDaysRaw = parseInt(String(formData.get("processingTimeMinDays") ?? ""), 10);
  const maxDaysRaw = parseInt(String(formData.get("processingTimeMaxDays") ?? ""), 10);
  const processingTimeMinDays = listingType === "MADE_TO_ORDER" && Number.isFinite(minDaysRaw) && minDaysRaw > 0 ? minDaysRaw : null;
  const processingTimeMaxDays = listingType === "MADE_TO_ORDER" && Number.isFinite(maxDaysRaw) && maxDaysRaw > 0 ? maxDaysRaw : null;

  if (!title || !imageUrls.length || !Number.isFinite(priceCents) || priceCents <= 0) {
    throw new Error("Please fill title, price, and upload at least one photo.");
  }
  if (priceCents < 0) throw new Error("Price cannot be negative.");
  if (priceCents > 10000000) throw new Error("Price cannot exceed $100,000.");
  if (stockQuantity !== null && stockQuantity < 0) throw new Error("Stock quantity cannot be negative.");
  if (processingTimeMaxDays !== null && processingTimeMaxDays > 365) throw new Error("Processing time cannot exceed 365 days.");

  // 3. Create listing with status based on saveAsDraft
  const created = await prisma.listing.create({
    data: {
      sellerId: seller.id,
      title,
      description,
      priceCents,
      tags,
      packagedLengthCm,
      packagedWidthCm,
      packagedHeightCm,
      packagedWeightGrams,
      category,
      listingType,
      stockQuantity,
      shipsWithinDays,
      processingTimeMinDays,
      processingTimeMaxDays,
      status: saveAsDraft ? "DRAFT" : "ACTIVE",
      photos: { create: imageUrls.map((url, i) => ({ url, sortOrder: i })) },
    },
  });

  revalidatePath("/browse");
  revalidatePath("/dashboard");

  // Assign metro geography from seller's location — non-fatal (runs for both draft and publish)
  try {
    const sellerLocation = await prisma.sellerProfile.findUnique({
      where: { id: seller.id },
      select: { lat: true, lng: true },
    });
    if (sellerLocation?.lat != null && sellerLocation?.lng != null) {
      const { findOrCreateMetro } = await import("@/lib/geo-metro");
      const { metroId, cityMetroId } = await findOrCreateMetro(sellerLocation.lat, sellerLocation.lng);
      if (metroId || cityMetroId) {
        await prisma.listing.update({ where: { id: created.id }, data: { metroId, cityMetroId } });
      }
    }
  } catch (e) {
    console.error("[geo-metro] Failed to assign metro to listing:", e);
  }

  // 4. Draft: skip ALL side effects and redirect immediately
  if (saveAsDraft) {
    redirect("/dashboard");
  }

  // Non-draft: run all side effects unchanged
  try {
    const listingCount = await prisma.listing.count({ where: { sellerId: seller.id } });
    if (listingCount === 1) {
      const sellerWithUser = await prisma.sellerProfile.findUnique({
        where: { id: seller.id },
        select: { displayName: true, user: { select: { email: true } } },
      });
      if (sellerWithUser?.user?.email) {
        await sendFirstListingCongrats({
          seller: { displayName: sellerWithUser.displayName, email: sellerWithUser.user.email },
          listing: { id: created.id, title: created.title, priceCents: created.priceCents },
        });
      }
    }
  } catch { /* non-fatal */ }

  // AI listing review + first-listing hold
  try {
    const sellerInfo = await prisma.sellerProfile.findUnique({
      where: { id: seller.id },
      select: {
        displayName: true,
        _count: { select: { listings: true } }
      }
    })

    const listingCount = sellerInfo?._count.listings ?? 0
    const isFirstListing = listingCount <= 1

    const { reviewListingWithAI } = await import('@/lib/ai-review')
    const { logAdminAction: logAction } = await import('@/lib/audit')

    const aiResult = await reviewListingWithAI({
      sellerId: seller.id,
      title: created.title,
      description: created.description,
      priceCents: created.priceCents,
      category: created.category ?? null,
      tags: created.tags,
      sellerName: sellerInfo?.displayName ?? 'Unknown',
      listingCount,
      imageUrls: imageUrls.slice(0, 4),
    }).catch(() => ({
      approved: false,
      flags: ['AI review error'],
      confidence: 0,
      reason: 'AI error — sending to admin review'
    }))

    const shouldHold = !aiResult.approved || aiResult.flags.length > 0 || aiResult.confidence < 0.8

    if (shouldHold) {
      await prisma.listing.update({
        where: { id: created.id },
        data: {
          status: 'PENDING_REVIEW',
          aiReviewFlags: aiResult.flags,
          aiReviewScore: aiResult.confidence,
        }
      })
      await logAction({
        adminId: seller.userId,
        action: 'AI_HOLD_LISTING',
        targetType: 'LISTING',
        targetId: created.id,
        reason: isFirstListing
          ? 'First listing from seller — requires admin review'
          : `AI flagged: ${aiResult.reason}`,
        metadata: { aiFlags: aiResult.flags, confidence: aiResult.confidence, isFirstListing },
      }).catch(() => {})
    }
  } catch { /* non-fatal */ }

  // Only notify followers if the listing went live (not held for review)
  const finalListing = await prisma.listing.findUnique({
    where: { id: created.id },
    select: { status: true },
  });
  if (finalListing?.status === "ACTIVE") {
    // Notify followers — fire-and-forget (don't await)
    void (async () => {
      try {
        const followers = await prisma.follow.findMany({
          where: { sellerProfileId: seller.id },
          select: { followerId: true, follower: { select: { email: true, name: true } } },
        });
        const sellerDisplay = seller.displayName ?? "A maker you follow";
        await Promise.all(
          followers.map((f) =>
            createNotification({
              userId: f.followerId,
              type: "FOLLOWED_MAKER_NEW_LISTING",
              title: `New listing from ${sellerDisplay}`,
              body: created.title,
              link: `/listing/${created.id}`,
            })
          )
        );
        const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com"}/listing/${created.id}`;
        const listingPrice = `$${(created.priceCents / 100).toFixed(2)}`;
        await Promise.allSettled(
          followers.slice(0, 500)
            .filter((f) => f.follower?.email)
            .map(async (f) => {
              if (await shouldSendEmail(f.followerId, "EMAIL_FOLLOWED_MAKER_NEW_LISTING")) {
                return sendNewListingFromFollowedMakerEmail({
                  to: f.follower.email!,
                  makerName: sellerDisplay,
                  listingTitle: created.title,
                  listingPrice,
                  listingUrl,
                });
              }
            })
        );
      } catch { /* non-fatal */ }
    })();
  }

  redirect(`/listing/${created.id}`);
}

export default async function NewListingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/listings/new");

  const { seller } = await ensureSeller();
  const sellerData = await prisma.sellerProfile.findUnique({
    where: { id: seller.id },
    select: { chargesEnabled: true },
  });
  const chargesEnabled = sellerData?.chargesEnabled ?? false;

  const sp = await searchParams;
  const errorMessage = sp.error === "stripe"
    ? "Connect your bank account in Shop Settings to publish listings."
    : null;

  return (
    <div className="max-w-2xl mx-auto p-8">
      {!chargesEnabled && (
        <div className="mb-6 bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 rounded">
          Connect your bank account in{" "}
          <a href="/dashboard/seller" className="underline font-medium">Shop Settings</a>{" "}
          to publish. You can still save drafts — they won&apos;t be visible to buyers until published.
        </div>
      )}

      <h1 className="text-2xl font-semibold mb-6">Create a listing</h1>

      <form action={createListing} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Title</label>
          <input name="title" required className="w-full border rounded px-3 py-2" />
        </div>

        <div>
          <label className="block text-sm mb-1">
            Description <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <textarea
            name="description"
            rows={6}
            maxLength={2000}
            placeholder="Describe your piece — materials, dimensions, technique, story behind it..."
            className="w-full border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400 resize-y"
          />
          <p className="text-xs text-neutral-400 mt-1">Up to 2,000 characters</p>
        </div>

        <div>
          <label className="block text-sm mb-1">Price (USD)</label>
          <input name="price" type="number" step="0.01" min="0" required className="w-full border rounded px-3 py-2" />
        </div>

        <div>
          <label className="block text-sm mb-1">Photos</label>
          <ImagesUploader max={8} fieldName="imageUrls" />
          <p className="mt-1 text-xs text-neutral-500">
            Tip: descriptive filenames (e.g. <span className="font-mono">walnut-cutting-board.jpg</span>) improve search visibility.
          </p>
        </div>

        <div>
          <label className="block text-sm mb-1">Tags</label>
          <TagsInput />
        </div>

        <div className="border rounded p-3">
          <div className="font-medium mb-2">Listing type</div>
          <ListingTypeFields />
        </div>

        <div className="border rounded p-3">
          <div className="font-medium mb-2">Packaged size &amp; weight (for calculated shipping)</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="mb-1">Length (in)</div>
              <input name="pkgLengthIn" type="number" step="0.1" min="0" className="w-full border rounded px-3 py-2" placeholder="e.g. 24" />
            </label>
            <label className="text-sm">
              <div className="mb-1">Width (in)</div>
              <input name="pkgWidthIn" type="number" step="0.1" min="0" className="w-full border rounded px-3 py-2" placeholder="e.g. 12" />
            </label>
            <label className="text-sm">
              <div className="mb-1">Height (in)</div>
              <input name="pkgHeightIn" type="number" step="0.1" min="0" className="w-full border rounded px-3 py-2" placeholder="e.g. 8" />
            </label>
            <label className="text-sm">
              <div className="mb-1">Weight (lb)</div>
              <input name="pkgWeightLb" type="number" step="0.1" min="0" className="w-full border rounded px-3 py-2" placeholder="e.g. 5.5" />
            </label>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Enter the dimensions/weight of the packaged item (ready to ship). We'll convert to cm/grams internally.
          </p>
        </div>

        {errorMessage && (
          <p className="text-sm text-red-600">{errorMessage}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="submit"
            name="saveAsDraft"
            value="false"
            className="flex-1 rounded px-4 py-2 bg-black text-white hover:bg-neutral-800"
          >
            Publish
          </button>
          <button
            type="submit"
            name="saveAsDraft"
            value="true"
            className="flex-1 rounded border border-neutral-300 px-4 py-2 bg-white text-neutral-700 hover:bg-neutral-50"
          >
            Save as Draft
          </button>
        </div>
      </form>
    </div>
  );
}
