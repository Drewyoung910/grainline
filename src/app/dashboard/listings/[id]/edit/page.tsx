// src/app/dashboard/listings/[id]/edit/page.tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import AddPhotosButton from "@/components/AddPhotosButton";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import CharCounter, { InputCharCounter } from "@/components/CharCounter";
import EditPhotoGrid from "@/components/EditPhotoGrid";
import ListingTypeVariantSection from "@/components/ListingTypeVariantSection";
import TagsInput from "@/components/TagsInput";
import { ListingStatus, type Category, type ListingType } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import { sanitizeText, sanitizeRichText, truncateText } from "@/lib/sanitize";
import { deleteR2ObjectByUrl } from "@/lib/r2";
import { publicListingPath } from "@/lib/publicPaths";
import { normalizeTag } from "@/lib/tags";
import { listingEditBlockReason } from "@/lib/listingEditState";
import { parseJsonArrayField } from "@/lib/formJson";
import { parseMoneyInputToCents } from "@/lib/money";
import { revalidateListingSearchCaches } from "@/lib/searchCache";
import { isFirstPartyMediaUrl } from "@/lib/urlValidation";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type SaveResult = { ok: boolean; error?: string };

const toFloat = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : v;
  if (s === "" || s === undefined) return null;
  const n = parseFloat(String(s));
  return Number.isFinite(n) ? n : null;
};
const toInt = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : v;
  if (s === "" || s === undefined) return null;
  const n = parseInt(String(s), 10);
  return Number.isFinite(n) ? n : null;
};

function normalizeVariantGroupsForCompare(
  groups: Array<{
    name: string;
    sortOrder: number;
    options: Array<{ label: string; priceAdjustCents: number; sortOrder: number; inStock: boolean }>;
  }>
) {
  return groups
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => ({
      name: group.name,
      options: group.options
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((option) => ({
          label: option.label,
          priceAdjustCents: option.priceAdjustCents,
          inStock: option.inStock,
        })),
    }));
}

async function updateListing(
  listingId: string,
  _prev: unknown,
  formData: FormData
): Promise<SaveResult> {
  "use server";

  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const title = truncateText(sanitizeText(String(formData.get("title") ?? "").trim()), 150);
  const description = truncateText(sanitizeRichText(String(formData.get("description") ?? "").trim()), 5000);
  const priceCents = parseMoneyInputToCents(formData.get("price"));

  // Tags
  let tags: string[] = [];
  const tagsJson = formData.get("tagsJson");
  const tagsResult = parseJsonArrayField(tagsJson);
  if (tagsResult.ok) {
    const set = new Set<string>();
    for (const raw of tagsResult.value) {
      if (typeof raw !== "string") continue;
      const t = normalizeTag(raw);
      if (!t) continue;
      if (set.size >= 10) break;
      set.add(t);
    }
    tags = Array.from(set);
  } else {
    console.warn("[listing-edit] invalid tagsJson:", tagsResult.error);
  }

  // Packaged dims / weight
  const packagedLengthCm = toFloat(formData.get("packagedLengthCm"));
  const packagedWidthCm = toFloat(formData.get("packagedWidthCm"));
  const packagedHeightCm = toFloat(formData.get("packagedHeightCm"));
  const packagedWeightGrams = toInt(formData.get("packagedWeightGrams"));

  // Category
  const categoryRaw = String(formData.get("category") ?? "").trim().toUpperCase();
  const category: Category | null = CATEGORY_VALUES.includes(categoryRaw) ? (categoryRaw as Category) : null;

  // Listing type & inventory
  const listingTypeRaw = String(formData.get("listingType") ?? "MADE_TO_ORDER");
  const listingType: ListingType = listingTypeRaw === "IN_STOCK" ? "IN_STOCK" : "MADE_TO_ORDER";
  const stockQuantityRaw = toInt(formData.get("stockQuantity"));
  const stockQuantity = listingType === "IN_STOCK" && stockQuantityRaw != null && stockQuantityRaw > 0
    ? stockQuantityRaw : null;
  const shipsWithinDaysRaw = toInt(formData.get("shipsWithinDays"));
  const shipsWithinDays = listingType === "IN_STOCK" && shipsWithinDaysRaw != null && shipsWithinDaysRaw > 0
    ? shipsWithinDaysRaw : null;

  // Processing time (only for MADE_TO_ORDER)
  const processingTimeMinDays = listingType === "MADE_TO_ORDER" ? toInt(formData.get("processingTimeMinDays")) : null;
  const processingTimeMaxDays = listingType === "MADE_TO_ORDER" ? toInt(formData.get("processingTimeMaxDays")) : null;

  // Meta description
  const metaDescription = truncateText(sanitizeText(String(formData.get("metaDescription") ?? "").trim()), 160) || null;

  // Materials (comma-separated string → array)
  const materialsRaw = sanitizeText(String(formData.get("materials") ?? "").trim());
  const materials = materialsRaw
    ? materialsRaw.split(",").map((s: string) => s.trim()).filter(Boolean).slice(0, 20)
    : [];

  // Product dimensions (inches)
  const productLengthIn = toFloat(formData.get("productLengthIn"));
  const productWidthIn = toFloat(formData.get("productWidthIn"));
  const productHeightIn = toFloat(formData.get("productHeightIn"));

  // Variants
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
          name: truncateText(sanitizeText(String(g.name ?? "")), 50),
          options: (Array.isArray(g.options) ? g.options : []).slice(0, 10).map((o: Record<string, unknown>) => ({
            label: truncateText(sanitizeText(String(o.label ?? "")), 50),
            priceAdjustCents: Math.round(Number(o.priceAdjustCents) || 0),
            inStock: Boolean(o.inStock ?? true),
          })),
        })).filter((g) => g.name && g.options.some((o) => o.label));
      }
    } catch { /* skip */ }
  }

  if (!title || priceCents === null || priceCents <= 0) {
    return { ok: false, error: "Please provide a valid title and price." };
  }
  if (priceCents > 10000000) return { ok: false, error: "Price cannot exceed $100,000." };
  if (listingType === "IN_STOCK" && stockQuantity === null) {
    return { ok: false, error: "In-stock listings need a stock quantity greater than zero." };
  }
  if (stockQuantity !== null && stockQuantity < 0) return { ok: false, error: "Stock quantity cannot be negative." };
  if (processingTimeMaxDays !== null && processingTimeMaxDays > 365) return { ok: false, error: "Processing time cannot exceed 365 days." };

  // Guard ownership
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
    include: {
      variantGroups: {
        orderBy: { sortOrder: "asc" },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!listing) return { ok: false, error: "Not allowed" };
  const blockReason = listingEditBlockReason(listing);
  if (blockReason) return { ok: false, error: blockReason };

  // Detect price/variant changes for priceVersion bump only — edits to an
  // ACTIVE listing no longer auto-trigger AI re-review. Sellers can edit
  // their listings freely; AI review only runs on the explicit publish
  // transitions (DRAFT/HIDDEN/REJECTED → ACTIVE via publishListingAction,
  // or new-listing initial publish). See CLAUDE.md "Listing edit re-review".
  const priceValueChanged = priceCents !== listing.priceCents;
  const previousVariantGroups = normalizeVariantGroupsForCompare(listing.variantGroups);
  const nextVariantGroups = normalizeVariantGroupsForCompare(
    variantGroups.map((group, groupIndex) => ({
      name: group.name,
      sortOrder: groupIndex,
      options: group.options.map((option, optionIndex) => ({
        label: option.label,
        priceAdjustCents: option.priceAdjustCents,
        sortOrder: optionIndex,
        inStock: option.inStock,
      })),
    }))
  );
  const variantsChanged = JSON.stringify(previousVariantGroups) !== JSON.stringify(nextVariantGroups);

  const updatedListing = await prisma.$transaction(async (tx) => {
    const updated = await tx.listing.update({
      where: { id: listingId },
      data: {
        title,
        description,
        priceCents,
        ...(priceValueChanged || variantsChanged ? { priceVersion: { increment: 1 } } : {}),
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
      },
      select: { title: true, updatedAt: true },
    });

    // Update variants with the listing row so failures cannot leave mixed old/new state.
    await tx.listingVariantGroup.deleteMany({ where: { listingId } });
    for (let gi = 0; gi < variantGroups.length; gi++) {
      const g = variantGroups[gi];
      if (!g.name || g.options.length === 0) continue;
      await tx.listingVariantGroup.create({
        data: {
          listingId,
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
        },
      });
    }

    return updated;
  });

  // Note: edits to ACTIVE listings used to trigger AI re-review automatically
  // — see git history pre-2026-05-11 for that flow. Removed because it made
  // every save feel like an unwanted re-publish. AI review now runs only at
  // explicit publish transitions (publishListingAction below for the Publish
  // button, or DRAFT/HIDDEN/REJECTED → ACTIVE). Acceptable security trade-off
  // for early-stage marketplace; photo-swap surveillance is admin-side.

  // Publish-on-save: if the user clicked the Publish / Resubmit-for-review
  // button on the edit form, route the listing through publishListingAction
  // (AI moderation). This is the ONLY path that triggers re-review on
  // existing ACTIVE listings — Save alone never re-reviews. PENDING_REVIEW
  // (already in review) and SOLD/SOLD_OUT (terminal) skip.
  const wantsPublish = formData.get("publish") === "true";
  if (wantsPublish) {
    const current = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { status: true },
    });
    if (
      current && (
        current.status === ListingStatus.DRAFT ||
        current.status === ListingStatus.HIDDEN ||
        current.status === ListingStatus.REJECTED ||
        current.status === ListingStatus.ACTIVE
      )
    ) {
      const { publishListingAction } = await import("@/app/seller/[id]/shop/actions");
      const publishResult = await publishListingAction(listingId);
      if ("error" in publishResult) {
        return { ok: false, error: publishResult.error };
      }
    }
  }

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${listing.sellerId}`);
  revalidatePath(`/seller/${listing.sellerId}/shop`);
  revalidatePath("/dashboard");
  revalidatePath("/browse");
  revalidateListingSearchCaches();

  // Re-query final status after AI re-review may have transitioned the listing.
  // Public listing path 404s for DRAFT, HIDDEN, REJECTED, PENDING_REVIEW — must
  // redirect to the edit page with a saved banner instead of the public URL.
  const final = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { status: true, title: true },
  });
  const finalStatus = final?.status ?? listing.status;
  const finalTitle = final?.title ?? updatedListing.title;

  if (
    finalStatus === ListingStatus.ACTIVE ||
    finalStatus === ListingStatus.SOLD ||
    finalStatus === ListingStatus.SOLD_OUT
  ) {
    redirect(publicListingPath(listingId, finalTitle));
  }

  // PENDING_REVIEW: redirect to the preview URL so the seller sees how their
  // listing appears (buyer-perspective). The edit page would block them with
  // editBlockReason, and the public listing page would 404 — preview is the
  // right surface to land on right after publishing or after AI auto-hold.
  if (finalStatus === ListingStatus.PENDING_REVIEW) {
    redirect(`${publicListingPath(listingId, finalTitle)}?preview=1`);
  }

  // DRAFT / HIDDEN / REJECTED: stay on the edit page with a saved banner so the
  // seller can keep editing.
  redirect(`/dashboard/listings/${listingId}/edit?saved=1`);
}


async function reorderPhotos(listingId: string, photoIds: string[]) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
  });
  if (!listing) return;
  if (listingEditBlockReason(listing)) return;

  await Promise.all(
    photoIds.map((id, i) =>
      prisma.photo.updateMany({ where: { id, listingId }, data: { sortOrder: i } })
    )
  );

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${listing.sellerId}`);
  revalidatePath(`/seller/${listing.sellerId}/shop`);
  revalidatePath("/browse");
  revalidatePath("/dashboard");
}

async function deletePhotoAction(listingId: string, photoId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const ok = await prisma.photo.findFirst({
    where: { id: photoId, listing: { seller: { user: { clerkId: userId } } } },
    select: { url: true, originalUrl: true, listing: { select: { status: true, isPrivate: true, rejectionReason: true, updatedAt: true, sellerId: true } } },
  });
  if (!ok) return;
  if (listingEditBlockReason(ok.listing)) return;

  await prisma.photo.delete({ where: { id: photoId } });
  await deleteR2ObjectByUrl(ok.url).catch((error) => {
    console.error("[listing photo delete] R2 delete failed:", error);
  });
  // Also clean up the preserved pre-crop source if it's a different
  // object than `url` (e.g. the photo had been re-cropped at least once,
  // so url and originalUrl point to different R2 objects).
  if (ok.originalUrl && ok.originalUrl !== ok.url) {
    await deleteR2ObjectByUrl(ok.originalUrl).catch((error) => {
      console.error("[listing photo delete] R2 original delete failed:", error);
    });
  }

  // Note: deleting a photo from an ACTIVE listing used to auto-flip the
  // listing into PENDING_REVIEW and re-run AI review. Removed 2026-05-11 —
  // sellers can manage their photos freely without triggering a re-review.
  // AI review only runs at explicit publish transitions.

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${ok.listing.sellerId}`);
  revalidatePath(`/seller/${ok.listing.sellerId}/shop`);
  revalidatePath("/dashboard");
}

async function replacePhotoAction(listingId: string, photoId: string, url: string) {
  "use server";
  const { userId } = await auth();
  if (!userId || !isFirstPartyMediaUrl(url)) return;

  const existing = await prisma.photo.findFirst({
    where: { id: photoId, listingId, listing: { seller: { user: { clerkId: userId } } } },
    select: {
      url: true,
      originalUrl: true,
      listing: {
        select: {
          id: true,
          title: true,
          description: true,
          priceCents: true,
          category: true,
          tags: true,
          status: true,
          isPrivate: true,
          rejectionReason: true,
          updatedAt: true,
          sellerId: true,
        },
      },
    },
  });
  if (!existing) return;
  if (listingEditBlockReason(existing.listing)) return;

  // Re-crop preserves the pre-crop source:
  //   - If originalUrl is already populated (this isn't the first re-crop),
  //     keep it untouched so future re-crops can still zoom out to the
  //     original frame, and only delete the previously-displayed `url`
  //     object from R2.
  //   - If originalUrl is null (legacy photo or first re-crop under the
  //     new field), lazily backfill it to the current `url` BEFORE we
  //     overwrite `url` with the new cropped version. The current url
  //     becomes the preserved original (do NOT delete it from R2). Future
  //     re-crops will fetch this preserved original as the source.
  if (existing.originalUrl) {
    await prisma.photo.updateMany({
      where: { id: photoId, listingId },
      data: { url },
    });
    await deleteR2ObjectByUrl(existing.url).catch((error) => {
      console.error("[listing photo replace] R2 delete failed:", error);
    });
  } else {
    await prisma.photo.updateMany({
      where: { id: photoId, listingId },
      data: { url, originalUrl: existing.url },
    });
    // Intentionally NOT deleting existing.url from R2 — it becomes the
    // preserved original for future re-crops.
  }

  // Note: replacing a photo on an ACTIVE listing used to auto-flip it into
  // PENDING_REVIEW and re-run AI review. Removed 2026-05-11 — seller can
  // re-crop freely. AI review only runs at explicit publish transitions.

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${existing.listing.sellerId}`);
  revalidatePath(`/seller/${existing.listing.sellerId}/shop`);
  revalidatePath("/browse");
  revalidatePath("/dashboard");
}

async function saveAltTextsAction(listingId: string, altTexts: Record<string, string>) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
  });
  if (!listing) return;
  if (listingEditBlockReason(listing)) return;

  for (const [photoId, text] of Object.entries(altTexts)) {
    const altText = truncateText(sanitizeText(text.trim()), 200) || null;
    await prisma.photo.updateMany({
      where: { id: photoId, listingId },
      data: { altText },
    });
  }

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath(`/seller/${listing.sellerId}`);
  revalidatePath(`/seller/${listing.sellerId}/shop`);
}

export default async function EditListingPage(props: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[]>>;
}) {
  const { id } = await props.params;
  const sp = props.searchParams ? await props.searchParams : {};
  const savedFlag = typeof sp.saved === "string" ? sp.saved : null;

  const { userId } = await auth();
  if (!userId) return notFound();

  const listing = await prisma.listing.findFirst({
    where: { id, seller: { user: { clerkId: userId } } },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      variantGroups: {
        orderBy: { sortOrder: "asc" },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      },
      seller: { select: { chargesEnabled: true } },
    },
  });
  if (!listing) return notFound();
  if (listing.status === "HIDDEN" && listing.isPrivate) return notFound();
  const editBlockReason = listingEditBlockReason(listing);
  const chargesEnabled = listing.seller.chargesEnabled;

  if (editBlockReason) {
    return (
      <main className="max-w-4xl mx-auto p-8">
        <h1 className="text-2xl font-semibold mb-6">Edit listing</h1>
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">This listing cannot be edited right now.</p>
          <p className="text-sm text-amber-800 mt-1">{editBlockReason}</p>
        </div>
        <Link href={`/seller/${listing.sellerId}/shop`} className="text-sm underline">
          Back to shop
        </Link>
      </main>
    );
  }

  const remaining = Math.max(0, 10 - listing.photos.length);

  // ACTIVE listings can also click Publish — that re-submits the current
  // (edited) content for AI re-review. Use case: seller edits an active
  // listing's title/photos/etc, then explicitly resubmits. Save alone no
  // longer auto-triggers re-review; Publish does.
  const canPublishFromEdit =
    listing.status === "DRAFT" ||
    listing.status === "HIDDEN" ||
    listing.status === "REJECTED" ||
    listing.status === "ACTIVE";
  const publishDisabledTitle = !chargesEnabled
    ? "Connect Stripe payouts in Shop Settings before publishing."
    : undefined;

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">Edit listing</h1>

      {savedFlag === "1" && (
        <div className="mb-6 rounded-md border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm font-medium text-green-800">Changes saved.</p>
        </div>
      )}

      {listing.status === "REJECTED" && listing.rejectionReason && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">This listing was rejected by our review team:</p>
          <p className="text-sm text-red-700 mt-1">{listing.rejectionReason}</p>
          <p className="text-sm text-red-600 mt-2">Please make the necessary changes and resubmit for review from your shop page.</p>
        </div>
      )}

      {listing.status === "REJECTED" && !listing.rejectionReason && (
        <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">This listing was rejected by our review team.</p>
          <p className="text-sm text-red-600 mt-1">Please make changes and resubmit for review from your shop page.</p>
        </div>
      )}

      <ActionForm action={updateListing.bind(null, id)} className="space-y-4 mb-10" preventEnterSubmit preserveOnError>
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Title</label>
          <InputCharCounter name="title" maxLength={100} defaultValue={listing.title} required />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Price (USD)</label>
          <input
            name="price"
            type="text"
            inputMode="decimal"
            pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
            defaultValue={(listing.priceCents / 100).toFixed(2)}
            required
            className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Tags</label>
          <TagsInput initial={listing.tags ?? []} />
        </div>

        <ListingTypeVariantSection
          listingType={listing.listingType}
          minDays={listing.processingTimeMinDays}
          maxDays={listing.processingTimeMaxDays}
          stockQuantity={listing.stockQuantity}
          shipsWithinDays={listing.shipsWithinDays}
          category={listing.category}
          initialVariantGroups={listing.variantGroups.map((g) => ({
              id: g.id,
              name: g.name,
              options: g.options.map((o) => ({
                id: o.id,
                label: o.label,
                priceAdjustCents: o.priceAdjustCents,
                inStock: o.inStock,
              })),
            }))}
        />

        {/* Packaged dims/weight */}
        <div className="card-section p-4">
          <label className="block text-sm font-medium text-neutral-700 mb-2">Packaged dimensions (cm / g)</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="packagedLengthCm" type="number" inputMode="decimal" step="0.1" placeholder="Length (cm)"
                   defaultValue={listing.packagedLengthCm ?? ""} className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm" />
            <input name="packagedWidthCm" type="number" inputMode="decimal" step="0.1" placeholder="Width (cm)"
                   defaultValue={listing.packagedWidthCm ?? ""} className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm" />
            <input name="packagedHeightCm" type="number" inputMode="decimal" step="0.1" placeholder="Height (cm)"
                   defaultValue={listing.packagedHeightCm ?? ""} className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm" />
            <input name="packagedWeightGrams" type="number" inputMode="numeric" step="1" placeholder="Weight (g)"
                   defaultValue={listing.packagedWeightGrams ?? ""} className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm" />
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            These should be the finished, ready-to-ship package size/weight per unit.
            If left blank, your seller default package will be used.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Description</label>
          <CharCounter name="description" maxLength={2000} rows={4} defaultValue={listing.description ?? ""} />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Meta description
            <span className="text-neutral-500 ml-1 font-normal">
              — helps your listing rank in search results
            </span>
          </label>
          <CharCounter
            name="metaDescription"
            maxLength={160}
            rows={2}
            defaultValue={listing.metaDescription ?? ""}
            placeholder="Briefly describe your piece for Google search results (160 chars max)"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Materials used</label>
          <input
            name="materials"
            defaultValue={(listing.materials ?? []).join(", ")}
            placeholder="e.g. walnut, maple, brass hardware"
            className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm"
          />
          <p className="text-xs text-neutral-500 mt-1">Comma-separated. Helps buyers find your piece.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            Product dimensions (inches)
            <span className="text-neutral-500 ml-1 font-normal">optional</span>
          </label>
          <div className="grid grid-cols-3 gap-3">
            <input name="productLengthIn" type="number" inputMode="decimal" step="0.1" min="0"
              defaultValue={listing.productLengthIn ?? ""}
              placeholder="Length" className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm" />
            <input name="productWidthIn" type="number" inputMode="decimal" step="0.1" min="0"
              defaultValue={listing.productWidthIn ?? ""}
              placeholder="Width" className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm" />
            <input name="productHeightIn" type="number" inputMode="decimal" step="0.1" min="0"
              defaultValue={listing.productHeightIn ?? ""}
              placeholder="Height" className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm" />
          </div>
          <p className="text-xs text-neutral-500 mt-1">The actual product size, not the shipping package.</p>
        </div>

        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <SubmitButton
            name="publish"
            value="false"
            pendingLabel="Saving..."
            className="flex-1 rounded-md border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-wait disabled:opacity-70"
          >
            Save changes
          </SubmitButton>
          {canPublishFromEdit && (
            <span className="flex-1" title={publishDisabledTitle}>
              <SubmitButton
                name="publish"
                value="true"
                disabled={!chargesEnabled}
                pendingLabel="Publishing..."
                title={publishDisabledTitle}
                className="w-full rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {listing.status === "REJECTED"
                  ? "Publish (Resubmit)"
                  : listing.status === "ACTIVE"
                    ? "Resubmit for review"
                    : "Publish"}
              </SubmitButton>
            </span>
          )}
        </div>
        {canPublishFromEdit && !chargesEnabled && (
          <p className="mt-2 text-xs text-amber-800">
            Connect Stripe payouts in{" "}
            <Link href="/dashboard/seller" className="underline">Shop Settings</Link>{" "}
            before publishing.
          </p>
        )}
      </ActionForm>

      {/* Photos section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Photos</h2>
          <AddPhotosButton listingId={id} remaining={remaining} />
        </div>
        <p className="text-xs text-neutral-500">
          Tip: descriptive filenames (e.g. <span className="font-mono">walnut-cutting-board.jpg</span>) improve search visibility.
        </p>

        <EditPhotoGrid
          photos={listing.photos.map((p) => ({ id: p.id, url: p.url, originalUrl: p.originalUrl, altText: p.altText }))}
          listingId={id}
          onReorder={reorderPhotos.bind(null, id)}
          onDelete={deletePhotoAction.bind(null, id)}
          onReplace={replacePhotoAction.bind(null, id)}
          onSaveAltTexts={saveAltTextsAction.bind(null, id)}
        />
      </section>
    </main>
  );
}
