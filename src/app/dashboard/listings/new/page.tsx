// src/app/dashboard/listings/new/page.tsx
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { renderNewListingFromFollowedMakerEmail, sendFirstListingCongrats } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { listingCreateRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";
import { filterR2PublicUrls } from "@/lib/urlValidation";
import PhotoManager from "@/components/PhotoManager";
import ActionForm from "@/components/ActionForm";
import CharCounter, { InputCharCounter } from "@/components/CharCounter";
import VariantEditor from "@/components/VariantEditor";
import TagsInput from "@/components/TagsInput";
import ListingTypeFields from "@/components/ListingTypeFields";
import { ListingStatus, type Category, type ListingType } from "@prisma/client";
import type { AIReviewResult } from "@/lib/ai-review";
import { CATEGORY_VALUES } from "@/lib/categories";
import { publicListingPath } from "@/lib/publicPaths";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function normalizeTag(input: string) {
  return input.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "").slice(0, 24);
}

// unit converters
const inToCm = (v: number) => Math.round((v * 2.54 + Number.EPSILON) * 100) / 100;
const lbToG  = (v: number) => Math.round(v * 453.59237);

async function createListing(_prevState: unknown, formData: FormData) {
  "use server";

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/listings/new");

  // 1. Read saveAsDraft FIRST — before any other logic
  const saveAsDraft = formData.get("saveAsDraft") === "true";

  const { success: rlOk } = await safeRateLimit(listingCreateRatelimit, userId);
  if (!rlOk) return { ok: false, error: "You can create up to 20 listings per day. Try again tomorrow." };

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
  imageUrls = filterR2PublicUrls(imageUrls, 8);

  // Alt texts (from PhotoManager hidden input)
  let imageAltTexts: string[] = [];
  const altJson = formData.get("imageAltTextsJson");
  if (typeof altJson === "string" && altJson.length) {
    try { imageAltTexts = (JSON.parse(altJson) as string[]).filter((v) => typeof v === "string"); } catch {}
  }

  // Meta description
  const metaDescription = sanitizeText(String(formData.get("metaDescription") ?? "").trim()).slice(0, 160) || null;

  // Materials (comma-separated string → array)
  const materialsRaw = sanitizeText(String(formData.get("materials") ?? "").trim());
  const materials = materialsRaw
    ? materialsRaw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20)
    : [];

  // Product dimensions (inches — stored directly, separate from packaged dims)
  const productLengthIn = Number(String(formData.get("productLengthIn") ?? "").trim()) || null;
  const productWidthIn = Number(String(formData.get("productWidthIn") ?? "").trim()) || null;
  const productHeightIn = Number(String(formData.get("productHeightIn") ?? "").trim()) || null;

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

  // Variants (up to 3 groups × 10 options)
  let variantGroups: Array<{
    name: string;
    options: Array<{ label: string; priceAdjustCents: number; inStock: boolean }>;
  }> = [];
  const variantsJson = formData.get("variantGroupsJson");
  if (typeof variantsJson === "string" && variantsJson.length > 2) {
    try {
      const parsed = JSON.parse(variantsJson);
      if (Array.isArray(parsed)) {
        variantGroups = parsed.slice(0, 3).map((g: Record<string, unknown>) => ({
          name: sanitizeText(String(g.name ?? "")).slice(0, 50),
          options: (Array.isArray(g.options) ? g.options : []).slice(0, 10).map((o: Record<string, unknown>) => ({
            label: sanitizeText(String(o.label ?? "")).slice(0, 50),
            priceAdjustCents: Math.round(Number(o.priceAdjustCents) || 0),
            inStock: Boolean(o.inStock ?? true),
          })),
        })).filter((g) => g.name && g.options.some((o) => o.label));
      }
    } catch { /* invalid JSON — skip variants */ }
  }

  if (!title || !imageUrls.length || !Number.isFinite(priceCents) || priceCents <= 0) {
    return { ok: false, error: "Please fill title, price, and upload at least one photo." };
  }
  if (priceCents < 0) return { ok: false, error: "Price cannot be negative." };
  if (priceCents > 10000000) return { ok: false, error: "Price cannot exceed $100,000." };
  if (listingType === "IN_STOCK" && stockQuantity === null) {
    return { ok: false, error: "In-stock listings need a stock quantity greater than zero." };
  }
  if (stockQuantity !== null && stockQuantity < 0) return { ok: false, error: "Stock quantity cannot be negative." };
  if (processingTimeMaxDays !== null && processingTimeMaxDays > 365) {
    return { ok: false, error: "Processing time cannot exceed 365 days." };
  }

  // 3. Create listing with status based on saveAsDraft
  const created = await prisma.listing.create({
    data: {
      sellerId: seller.id,
      title,
      description,
      priceCents,
      tags,
      metaDescription,
      materials,
      productLengthIn,
      productWidthIn,
      productHeightIn,
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
      status: saveAsDraft ? ListingStatus.DRAFT : ListingStatus.PENDING_REVIEW,
      photos: { create: imageUrls.map((url, i) => ({
        url,
        sortOrder: i,
        altText: imageAltTexts[i] ? sanitizeText(imageAltTexts[i].trim()).slice(0, 200) || null : null,
      })) },
      variantGroups: variantGroups.length > 0 ? {
        create: variantGroups.map((g, gi) => ({
          name: g.name,
          sortOrder: gi,
          options: {
            create: g.options.filter((o) => o.label).map((o, oi) => ({
              label: o.label,
              priceAdjustCents: o.priceAdjustCents,
              sortOrder: oi,
              inStock: o.inStock,
            })),
          },
        })),
      } : undefined,
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

  // 4. Draft: redirect to preview so seller can see what it looks like
  if (saveAsDraft) {
    redirect(`${publicListingPath(created.id, created.title)}?preview=1`);
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

    const { reviewListingWithAI } = await import('@/lib/ai-review')

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
    }).catch((): AIReviewResult => ({
      approved: false,
      flags: ['AI review error'],
      confidence: 0,
      reason: 'AI error — sending to admin review',
      altTexts: [],
    }))

    const shouldHold = !aiResult.approved || aiResult.flags.length > 0 || aiResult.confidence < 0.8

    if (shouldHold) {
      await prisma.listing.update({
        where: { id: created.id },
        data: {
          status: ListingStatus.PENDING_REVIEW,
          aiReviewFlags: aiResult.flags,
          aiReviewScore: aiResult.confidence,
        }
      })
    } else {
      await prisma.listing.update({
        where: { id: created.id },
        data: {
          status: ListingStatus.ACTIVE,
          aiReviewFlags: aiResult.flags,
          aiReviewScore: aiResult.confidence,
        },
      })
      await prisma.$executeRaw`
        UPDATE "Listing"
        SET status = 'SOLD_OUT'
        WHERE id = ${created.id}
          AND "listingType" = 'IN_STOCK'
          AND COALESCE("stockQuantity", 0) <= 0
          AND status = 'ACTIVE'
      `;
    }

    // Backfill AI-generated alt texts on photos that don't already have seller-provided alt text
    console.log(`[ai-alt-text] AI returned ${aiResult.altTexts?.length ?? 0} alt texts for listing ${created.id}`)
    if (aiResult.altTexts?.length) {
      try {
        const photos = await prisma.photo.findMany({
          where: { listingId: created.id },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, altText: true },
        })
        let updated = 0
        for (let i = 0; i < Math.min(photos.length, aiResult.altTexts.length); i++) {
          if (aiResult.altTexts[i] && !photos[i].altText) {
            const { sanitizeText: sanitizeAlt } = await import("@/lib/sanitize");
            await prisma.photo.update({
              where: { id: photos[i].id },
              data: { altText: sanitizeAlt(aiResult.altTexts[i]).slice(0, 200) },
            })
            updated++
          }
        }
        console.log(`[ai-alt-text] Backfilled ${updated} alt texts for listing ${created.id}`)
      } catch (e) {
        console.error('[ai-alt-text] Backfill failed:', e instanceof Error ? e.message : e)
      }
    }
  } catch {
    await prisma.listing.update({
      where: { id: created.id },
      data: {
        status: ListingStatus.PENDING_REVIEW,
        aiReviewFlags: ["AI review error"],
        aiReviewScore: 0,
      },
    }).catch(() => {});
  }

  // Only notify followers if the listing went live (not held for review)
  const finalListing = await prisma.listing.findUnique({
    where: { id: created.id },
    select: { status: true },
  });
  if (finalListing?.status === "ACTIVE") {
    // Notify followers after the response so listing creation stays responsive.
    after(async () => {
      try {
        const followers = await prisma.follow.findMany({
          where: {
            sellerProfileId: seller.id,
            follower: { banned: false, deletedAt: null },
          },
          select: { followerId: true, follower: { select: { email: true, name: true } } },
        });
        const sellerDisplay = seller.displayName ?? "A maker you follow";
        await mapWithConcurrency(followers, 10, (f) =>
          createNotification({
            userId: f.followerId,
            type: "FOLLOWED_MAKER_NEW_LISTING",
            title: `New listing from ${sellerDisplay}`,
            body: created.title,
            link: publicListingPath(created.id, created.title),
          }),
        );
        const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com"}${publicListingPath(created.id, created.title)}`;
        const listingPrice = `$${(created.priceCents / 100).toFixed(2)}`;
        const emailRecipients = followers.filter((f) => f.follower?.email);
        await mapWithConcurrency(emailRecipients, 5, async (f) => {
          if (await shouldSendEmail(f.followerId, "EMAIL_FOLLOWED_MAKER_NEW_LISTING")) {
            const email = renderNewListingFromFollowedMakerEmail({
              to: f.follower.email!,
              makerName: sellerDisplay,
              listingTitle: created.title,
              listingPrice,
              listingUrl,
            });
            await enqueueEmailOutbox({
              ...email,
              dedupKey: `followed-listing:${created.id}:${f.followerId}`,
              userId: f.followerId,
              preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
            });
          }
        });
      } catch { /* non-fatal */ }
    });
  }

  redirect(publicListingPath(created.id, created.title));
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
          <Link href="/dashboard/seller" className="underline font-medium">Shop Settings</Link>{" "}
          to publish. You can still save drafts — they won&apos;t be visible to buyers until published.
        </div>
      )}

      <h1 className="text-2xl font-semibold mb-6">Create a listing</h1>

      <ActionForm action={createListing} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Title</label>
          <InputCharCounter name="title" maxLength={100} required />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Description <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <CharCounter
            name="description"
            maxLength={2000}
            rows={6}
            placeholder="Describe your piece — materials, dimensions, technique, story behind it..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Meta description
            <span className="text-neutral-400 ml-1 font-normal">
              — helps your listing rank in search results
            </span>
          </label>
          <CharCounter
            name="metaDescription"
            maxLength={160}
            rows={2}
            placeholder="Briefly describe your piece for Google search results (160 chars max)"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Materials used</label>
          <input
            name="materials"
            placeholder="e.g. walnut, maple, brass hardware"
            className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
          <p className="text-xs text-neutral-400 mt-1">Comma-separated. Helps buyers find your piece.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Product dimensions (inches)
            <span className="text-neutral-400 ml-1 font-normal">optional</span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <input name="productLengthIn" type="number" step="0.1" min="0"
              placeholder="Length" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            <input name="productWidthIn" type="number" step="0.1" min="0"
              placeholder="Width" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            <input name="productHeightIn" type="number" step="0.1" min="0"
              placeholder="Height" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
          </div>
          <p className="text-xs text-neutral-400 mt-1">The actual product size, not the shipping package.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Price (USD)</label>
          <input name="price" type="number" step="0.01" min="0" required className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
        </div>

        <div>
          <label className="block text-sm mb-1">Photos</label>
          <PhotoManager max={8} />
          <p className="mt-1 text-xs text-neutral-500">
            Tip: descriptive filenames (e.g. <span className="font-mono">walnut-cutting-board.jpg</span>) improve search visibility.
          </p>
        </div>

        <div>
          <label className="block text-sm mb-1">Tags</label>
          <TagsInput />
        </div>

        <div className="card-section p-4">
          <div className="text-sm font-medium text-neutral-700 mb-2">Listing type</div>
          <ListingTypeFields />
        </div>

        <div className="card-section p-4">
          <VariantEditor />
        </div>

        <div className="card-section p-4">
          <div className="text-sm font-medium text-neutral-700 mb-2">Packaged size &amp; weight (for calculated shipping)</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="mb-1">Length (in)</div>
              <input name="pkgLengthIn" type="number" step="0.1" min="0" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" placeholder="e.g. 24" />
            </label>
            <label className="text-sm">
              <div className="mb-1">Width (in)</div>
              <input name="pkgWidthIn" type="number" step="0.1" min="0" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" placeholder="e.g. 12" />
            </label>
            <label className="text-sm">
              <div className="mb-1">Height (in)</div>
              <input name="pkgHeightIn" type="number" step="0.1" min="0" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" placeholder="e.g. 8" />
            </label>
            <label className="text-sm">
              <div className="mb-1">Weight (lb)</div>
              <input name="pkgWeightLb" type="number" step="0.1" min="0" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" placeholder="e.g. 5.5" />
            </label>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Enter the dimensions/weight of the packaged item (ready to ship). We&apos;ll convert to cm/grams internally.
          </p>
        </div>

        {errorMessage && (
          <p className="text-sm text-red-600">{errorMessage}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="submit"
            name="saveAsDraft"
            value="false"
            className="flex-1 rounded-md px-4 py-2.5 bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
          >
            Publish
          </button>
          <button
            type="submit"
            name="saveAsDraft"
            value="true"
            className="flex-1 rounded-md border border-neutral-200 px-4 py-2.5 bg-white text-neutral-700 text-sm font-medium hover:bg-neutral-50"
          >
            Save as Draft
          </button>
        </div>
      </ActionForm>
    </div>
  );
}
