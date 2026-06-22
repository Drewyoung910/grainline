// src/app/dashboard/listings/[id]/edit/page.tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
import { listingPriceMaxError } from "@/lib/listingPrice";
import {
  normalizeVariantPriceAdjustCents,
  validateVariantGroupsForBasePrice,
} from "@/lib/listingVariants";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";
import { isFirstPartyMediaUrlForUser } from "@/lib/urlValidation";
import { filterVerifiedFirstPartyMediaUrlsForUser } from "@/lib/uploadPersistenceVerification";
import { claimDirectUploadsForUrls } from "@/lib/directUploadLifecycle";
import { expireOpenCheckoutSessionsForListing } from "@/lib/checkoutSessionExpiry";
import { listingMutationRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { MAX_MANUAL_STOCK_QUANTITY } from "@/lib/stockMutationState";
import { logServerError } from "@/lib/serverErrorLogger";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type SaveResult = { ok: boolean; error?: string };

function queueCheckoutSessionExpiryForListing(listingId: string, sellerId: string, source: string) {
  after(() =>
    expireOpenCheckoutSessionsForListing({
      listingId,
      sellerId,
      source,
    }),
  );
}

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

type ExistingPhotoForManifest = {
  id: string;
  url: string;
  originalUrl: string | null;
  altText: string | null;
};

type PhotoManifestItem = {
  id: string | null;
  url: string;
  originalUrl: string | null;
  altText: string | null;
};

class ListingPhotoConflictError extends Error {
  constructor() {
    super("Listing photos changed. Refresh and try again.");
    this.name = "ListingPhotoConflictError";
  }
}

function parsePhotoManifestField(
  value: FormDataEntryValue | null,
  existingPhotos: ExistingPhotoForManifest[],
  clerkUserId: string,
): { ok: true; photos: PhotoManifestItem[] } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim() === "") {
    return {
      ok: true,
      photos: existingPhotos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        originalUrl: photo.originalUrl,
        altText: photo.altText,
      })),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, error: "Invalid photo data. Refresh and try again." };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Invalid photo data. Refresh and try again." };
  }
  if (parsed.length > 10) {
    return { ok: false, error: "Listings can have up to 10 photos." };
  }

  const existingById = new Map(existingPhotos.map((photo) => [photo.id, photo]));
  const photos: PhotoManifestItem[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "Invalid photo data. Refresh and try again." };
    }
    const item = raw as Record<string, unknown>;
    const rawId = typeof item.id === "string" && item.id.trim() ? item.id.trim() : null;
    const existingPhoto = rawId ? existingById.get(rawId) : null;
    if (rawId && !existingPhoto) {
      return { ok: false, error: "Invalid photo data. Refresh and try again." };
    }
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const isExistingUrl =
      Boolean(existingPhoto) &&
      (url === existingPhoto?.url || (existingPhoto?.originalUrl ? url === existingPhoto.originalUrl : false));
    if (!url || (!isExistingUrl && !isFirstPartyMediaUrlForUser(url, clerkUserId, ["listingImage"]))) {
      return { ok: false, error: "Invalid photo URL. Use uploaded Grainline images only." };
    }
    const rawOriginalUrl = typeof item.originalUrl === "string" ? item.originalUrl.trim() : "";
    const originalUrl = existingPhoto
      ? existingPhoto.originalUrl ?? existingPhoto.url
      : rawOriginalUrl && isFirstPartyMediaUrlForUser(rawOriginalUrl, clerkUserId, ["listingImage"])
        ? rawOriginalUrl
        : url;
    const altText = truncateText(sanitizeText(String(item.altText ?? "").trim()), 200) || null;
    photos.push({ id: rawId, url, originalUrl, altText });
  }

  return { ok: true, photos };
}

async function updateListing(
  listingId: string,
  _prev: unknown,
  formData: FormData
): Promise<SaveResult> {
  "use server";

  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };
  const { success: rlOk } = await safeRateLimit(listingMutationRatelimit, userId);
  if (!rlOk) return { ok: false, error: "Too many listing updates. Try again shortly." };

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
            priceAdjustCents: normalizeVariantPriceAdjustCents(o.priceAdjustCents),
            inStock: Boolean(o.inStock ?? true),
          })),
        })).filter((g) => g.name && g.options.some((o) => o.label));
      }
    } catch { /* skip */ }
  }

  if (!title || priceCents === null || priceCents <= 0) {
    return { ok: false, error: "Please provide a valid title and price." };
  }
  const priceMaxError = listingPriceMaxError(priceCents);
  if (priceMaxError) return { ok: false, error: priceMaxError };
  const variantPriceError = validateVariantGroupsForBasePrice(variantGroups, priceCents);
  if (variantPriceError) return { ok: false, error: variantPriceError };
  if (listingType === "IN_STOCK" && stockQuantity === null) {
    return { ok: false, error: "In-stock listings need a stock quantity greater than zero." };
  }
  if (stockQuantity !== null && stockQuantity < 0) return { ok: false, error: "Stock quantity cannot be negative." };
  if (stockQuantity !== null && stockQuantity > MAX_MANUAL_STOCK_QUANTITY) {
    return { ok: false, error: `Stock quantity cannot exceed ${MAX_MANUAL_STOCK_QUANTITY}.` };
  }
  if (processingTimeMaxDays !== null && processingTimeMaxDays > 365) return { ok: false, error: "Processing time cannot exceed 365 days." };
  if (
    listingType === "MADE_TO_ORDER" &&
    processingTimeMinDays !== null &&
    processingTimeMaxDays !== null &&
    processingTimeMinDays > processingTimeMaxDays
  ) {
    return { ok: false, error: "Processing time minimum cannot exceed the maximum." };
  }

  // Guard ownership
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
    include: {
      seller: { select: { userId: true } },
      photos: { orderBy: { sortOrder: "asc" } },
      variantGroups: {
        orderBy: { sortOrder: "asc" },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!listing) return { ok: false, error: "Not allowed" };
  const blockReason = listingEditBlockReason(listing);
  if (blockReason) return { ok: false, error: blockReason };

  const photoManifest = parsePhotoManifestField(formData.get("photoManifestJson"), listing.photos, userId);
  if (!photoManifest.ok) return { ok: false, error: photoManifest.error };
  if (photoManifest.photos.length === 0) {
    return { ok: false, error: "Add at least one listing photo before saving." };
  }
  const nextPhotosById = new Map(
    photoManifest.photos
      .filter((photo): photo is PhotoManifestItem & { id: string } => Boolean(photo.id))
      .map((photo) => [photo.id, photo]),
  );
  const retainedUrls = new Set(
    photoManifest.photos.flatMap((photo) => [photo.url, photo.originalUrl].filter((url): url is string => Boolean(url))),
  );
  const existingPhotoUrls = new Set(
    listing.photos.flatMap((photo) => [photo.url, photo.originalUrl].filter((url): url is string => Boolean(url))),
  );
  const submittedNewPhotoUrls = new Set<string>();
  for (const photo of photoManifest.photos) {
    for (const url of [photo.url, photo.originalUrl].filter((value): value is string => Boolean(value))) {
      if (!existingPhotoUrls.has(url)) submittedNewPhotoUrls.add(url);
    }
  }
  if (submittedNewPhotoUrls.size > 0) {
    const verifiedNewPhotoUrls = new Set(await filterVerifiedFirstPartyMediaUrlsForUser({
      urls: [...submittedNewPhotoUrls],
      max: submittedNewPhotoUrls.size,
      clerkUserId: userId,
      accountUserId: listing.seller.userId,
      allowedEndpoints: ["listingImage"],
    }));
    if (verifiedNewPhotoUrls.size !== submittedNewPhotoUrls.size) {
      return { ok: false, error: "Invalid photo URL. Re-upload the photo and try again." };
    }
  }
  const r2CleanupUrls = new Set<string>();
  for (const existingPhoto of listing.photos) {
    const nextPhoto = nextPhotosById.get(existingPhoto.id);
    if (!nextPhoto) {
      if (!retainedUrls.has(existingPhoto.url)) r2CleanupUrls.add(existingPhoto.url);
      if (existingPhoto.originalUrl && existingPhoto.originalUrl !== existingPhoto.url && !retainedUrls.has(existingPhoto.originalUrl)) {
        r2CleanupUrls.add(existingPhoto.originalUrl);
      }
      continue;
    }
    if (
      nextPhoto.url !== existingPhoto.url &&
      existingPhoto.originalUrl &&
      existingPhoto.originalUrl !== existingPhoto.url &&
      !retainedUrls.has(existingPhoto.url)
    ) {
      r2CleanupUrls.add(existingPhoto.url);
    }
  }

  // Detect price/variant changes for priceVersion bump and to flag this
  // save as a content edit that should go through AI re-review.
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
  // Save on an ACTIVE or SOLD_OUT public listing triggers AI re-review of the
  // new content before that content can remain public or be restocked to ACTIVE.
  // Photo upload alone does NOT (that was the original "kick-out" bug —
  // photos route used to flip status mid-edit). The seller controls
  // when review runs by clicking Save. Bypassing review by skipping
  // Save isn't possible because Save is the only way to commit edits.
  const needsPublicContentReview =
    listing.status === ListingStatus.ACTIVE ||
    listing.status === ListingStatus.SOLD_OUT;
  const approvedPublicStatus =
    listing.status === ListingStatus.ACTIVE &&
    listingType === "IN_STOCK" &&
    (stockQuantity ?? 0) <= 0
      ? ListingStatus.SOLD_OUT
      : listing.status;

  let updatedListing: { title: string; updatedAt: Date };
  try {
    updatedListing = await prisma.$transaction(async (tx) => {
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
          ...(needsPublicContentReview ? { status: ListingStatus.PENDING_REVIEW } : {}),
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

      const retainedPhotoIds = photoManifest.photos
        .map((photo) => photo.id)
        .filter((id): id is string => Boolean(id));
      await tx.photo.deleteMany({
        where: retainedPhotoIds.length
          ? { listingId, id: { notIn: retainedPhotoIds } }
          : { listingId },
      });
      for (let index = 0; index < photoManifest.photos.length; index++) {
        const photo = photoManifest.photos[index];
        if (photo.id) {
          const updatedPhoto = await tx.photo.updateMany({
            where: { id: photo.id, listingId },
            data: {
              url: photo.url,
              originalUrl: photo.originalUrl ?? photo.url,
              altText: photo.altText,
              sortOrder: index,
            },
          });
          if (updatedPhoto.count === 0) {
            throw new ListingPhotoConflictError();
          }
        } else {
          await tx.photo.create({
            data: {
              listingId,
              url: photo.url,
              originalUrl: photo.originalUrl ?? photo.url,
              altText: photo.altText,
              sortOrder: index,
            },
          });
        }
      }
      await claimDirectUploadsForUrls({
        client: tx,
        urls: [...submittedNewPhotoUrls],
        userId: listing.seller.userId,
        claimedByType: "Listing",
        claimedById: listingId,
      });

      return updated;
    });
    if (needsPublicContentReview && listing.status === ListingStatus.ACTIVE) {
      queueCheckoutSessionExpiryForListing(listingId, listing.sellerId, "listing_edit_pending_review");
    }
  } catch (error) {
    if (error instanceof ListingPhotoConflictError) {
      await Promise.all(
        Array.from(submittedNewPhotoUrls).map((url) =>
          deleteR2ObjectByUrl(url).catch((cleanupError) => {
            logServerError(cleanupError, {
              source: "listing_photo_conflict_cleanup",
              level: "warning",
              extra: { listingId, sellerId: listing.sellerId },
            });
          }),
        ),
      );
      return { ok: false, error: error.message };
    }
    throw error;
  }

  // Save on an ACTIVE or SOLD_OUT listing commits edited content into
  // PENDING_REVIEW first, then restores the public status only after AI approval.
  // Photo changes are staged in the edit form and committed here, so
  // upload/re-crop/reorder/delete cannot kick the seller into review before they
  // press Save.
  // - If AI approves: listing stays in its public status, new content is live.
  // - If AI flags or errors: listing flips to PENDING_REVIEW. The seller
  //   stays on the edit page (?saved=pending banner) instead of being
  //   redirected to a 404'd public listing path.
  if (needsPublicContentReview) {
    try {
      const seller = await prisma.sellerProfile.findFirst({
        where: { listings: { some: { id: listingId } } },
        select: { id: true, displayName: true, chargesEnabled: true, _count: { select: { listings: true } } },
      });
      if (seller?.chargesEnabled) {
        const photos = await prisma.photo.findMany({
          where: { listingId },
          select: { url: true },
          orderBy: { sortOrder: "asc" },
          take: 10,
        });
        const { reviewListingWithAI } = await import("@/lib/ai-review");
        const aiResult = await reviewListingWithAI({
          listingId,
          sellerId: seller.id,
          title,
          description,
          priceCents,
          currency: listing.currency,
          category: category ?? null,
          tags,
          sellerName: seller.displayName,
          listingCount: seller._count.listings,
          imageUrls: photos.map((p) => p.url),
        }).catch(() => ({
          approved: false,
          flags: ["AI review error"] as string[],
          confidence: 0,
          reason: "AI error",
          altTexts: [] as string[],
        }));

        // Backfill AI-generated alt texts on photos missing seller-provided alt text.
        const { backfillEmptyAltTexts } = await import("@/lib/photoAltTextBackfill");
        await backfillEmptyAltTexts(listingId, aiResult.altTexts);

        const shouldHold =
          !aiResult.approved || aiResult.flags.length > 0 || aiResult.confidence < 0.8;
        if (shouldHold) {
          const holdResult = await prisma.listing.updateMany({
            where: { id: listingId, sellerId: listing.sellerId, status: ListingStatus.PENDING_REVIEW, updatedAt: updatedListing.updatedAt },
            data: {
              status: ListingStatus.PENDING_REVIEW,
              aiReviewFlags: aiResult.flags,
              aiReviewScore: aiResult.confidence,
            },
          });
          if (holdResult.count > 0) {
            queueCheckoutSessionExpiryForListing(listingId, seller.id, "listing_edit_ai_hold");
          }
        } else {
          // Stays in the current public status; refresh AI metadata for this pass.
          await prisma.listing.updateMany({
            where: { id: listingId, sellerId: listing.sellerId, status: ListingStatus.PENDING_REVIEW, updatedAt: updatedListing.updatedAt },
            data: {
              status: approvedPublicStatus,
              aiReviewFlags: aiResult.flags,
              aiReviewScore: aiResult.confidence,
            },
          });
        }
      } else {
        // Seller lost chargesEnabled mid-edit: send the listing to draft.
        const draftResult = await prisma.listing.updateMany({
          where: { id: listingId, sellerId: listing.sellerId, status: ListingStatus.PENDING_REVIEW, updatedAt: updatedListing.updatedAt },
          data: { status: ListingStatus.DRAFT },
        });
        if (draftResult.count > 0 && seller) {
          queueCheckoutSessionExpiryForListing(listingId, seller.id, "listing_edit_seller_disconnected");
        }
      }
    } catch (err) {
      logServerError(err, {
        source: "listing_update_ai_re_review",
        level: "warning",
        extra: { listingId, sellerId: listing.sellerId },
      });
      // AI infrastructure error — flip to PENDING_REVIEW conservatively so
      // staff can review the new content.
      const pendingResult = await prisma.listing.updateMany({
        where: { id: listingId, sellerId: listing.sellerId, status: ListingStatus.PENDING_REVIEW, updatedAt: updatedListing.updatedAt },
        data: {
          status: ListingStatus.PENDING_REVIEW,
          aiReviewFlags: ["AI review error"],
          aiReviewScore: 0,
        },
      });
      if (pendingResult.count > 0) {
        queueCheckoutSessionExpiryForListing(listingId, listing.sellerId, "listing_edit_ai_error");
      }
    }
  }

  // Publish-on-save: if the user clicked the Publish button on the edit form
  // (only shown for DRAFT/HIDDEN/REJECTED — these are not-yet-public statuses
  // that need the publish flow to transition to ACTIVE). For ACTIVE/SOLD_OUT
  // source listings the Save branch above already runs AI re-review, so no
  // Publish button is shown on those statuses.
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
        current.status === ListingStatus.REJECTED
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
  revalidateFeaturedMakerCaches();

  await Promise.all(
    Array.from(r2CleanupUrls).map((url) =>
      deleteR2ObjectByUrl(url).catch((error) => {
        logServerError(error, {
          source: "listing_photo_save_cleanup",
          level: "warning",
          extra: { listingId, sellerId: listing.sellerId },
        });
      }),
    ),
  );

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

  // Publish button is shown on not-yet-public statuses only — for ACTIVE
  // listings the Save flow already runs AI re-review on edits, so no
  // separate Publish/Resubmit button is needed (and shouldn't be visible —
  // having one would imply Save bypasses review, which it does not).
  const canPublishFromEdit =
    listing.status === "DRAFT" ||
    listing.status === "HIDDEN" ||
    listing.status === "REJECTED";
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
        {/* Section order intentionally mirrors the create-listing page:
            Title → Description → Meta → Materials → Product dimensions →
            Price → Tags → Listing type/variants → Packaged dimensions.
            Keep these in lockstep so the create and edit flows feel like
            the same form. */}
        <div>
          <label htmlFor="listing-title" className="block text-sm font-medium text-neutral-700 mb-1">Title</label>
          <InputCharCounter id="listing-title" name="title" maxLength={100} defaultValue={listing.title} required />
        </div>

        <div>
          <label htmlFor="listing-description" className="block text-sm font-medium text-neutral-700 mb-1">Description</label>
          <CharCounter id="listing-description" name="description" maxLength={2000} rows={4} defaultValue={listing.description ?? ""} />
        </div>

        <div>
          <label htmlFor="listing-meta-description" className="block text-sm font-medium text-neutral-700 mb-1">
            Meta description
            <span className="text-neutral-500 ml-1 font-normal">
              — helps your listing rank in search results
            </span>
          </label>
          <CharCounter
            id="listing-meta-description"
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
            className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
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
              placeholder="Length" className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            <input name="productWidthIn" type="number" inputMode="decimal" step="0.1" min="0"
              defaultValue={listing.productWidthIn ?? ""}
              placeholder="Width" className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            <input name="productHeightIn" type="number" inputMode="decimal" step="0.1" min="0"
              defaultValue={listing.productHeightIn ?? ""}
              placeholder="Height" className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
          </div>
          <p className="text-xs text-neutral-500 mt-1">The actual product size, not the shipping package.</p>
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
            className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
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
                   defaultValue={listing.packagedLengthCm ?? ""} className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            <input name="packagedWidthCm" type="number" inputMode="decimal" step="0.1" placeholder="Width (cm)"
                   defaultValue={listing.packagedWidthCm ?? ""} className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            <input name="packagedHeightCm" type="number" inputMode="decimal" step="0.1" placeholder="Height (cm)"
                   defaultValue={listing.packagedHeightCm ?? ""} className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
            <input name="packagedWeightGrams" type="number" inputMode="numeric" step="1" placeholder="Weight (g)"
                   defaultValue={listing.packagedWeightGrams ?? ""} className="w-full border border-neutral-200 bg-white rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300" />
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            These should be the finished, ready-to-ship package size/weight per unit.
            If left blank, your seller default package will be used.
          </p>
        </div>

        {/* Photos section — changes are staged in the form and saved together
            with the rest of the listing so ACTIVE edits hit AI review at the
            explicit Save boundary. */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Photos</h2>
          <p className="text-xs text-neutral-500">
            Tip: descriptive filenames (e.g. <span className="font-mono">walnut-cutting-board.jpg</span>) improve search visibility.
          </p>

          <EditPhotoGrid
            photos={listing.photos.map((p) => ({ id: p.id, url: p.url, originalUrl: p.originalUrl, altText: p.altText }))}
            maxPhotos={10}
          />
        </section>

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
                {listing.status === "REJECTED" ? "Publish (Resubmit)" : "Publish"}
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
    </main>
  );
}
