// src/app/dashboard/listings/[id]/edit/page.tsx
import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import AddPhotosButton from "@/components/AddPhotosButton";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import CharCounter, { InputCharCounter } from "@/components/CharCounter";
import EditPhotoGrid from "@/components/EditPhotoGrid";
import VariantEditor from "@/components/VariantEditor";
import TagsInput from "@/components/TagsInput";
import ListingTypeFields from "@/components/ListingTypeFields";
import type { Category, ListingType } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type SaveResult = { ok: boolean; error?: string };

function normalizeTag(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 24);
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

async function updateListing(
  listingId: string,
  _prev: unknown,
  formData: FormData
): Promise<SaveResult> {
  "use server";

  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const title = sanitizeText(String(formData.get("title") ?? "").trim());
  const description = sanitizeRichText(String(formData.get("description") ?? "").trim());
  const priceStr = String(formData.get("price") ?? "0");
  const priceCents = Math.round(parseFloat(priceStr) * 100);

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
  const metaDescription = sanitizeText(String(formData.get("metaDescription") ?? "").trim()).slice(0, 160) || null;

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
          name: sanitizeText(String(g.name ?? "")).slice(0, 50),
          options: (Array.isArray(g.options) ? g.options : []).slice(0, 10).map((o: Record<string, unknown>) => ({
            label: sanitizeText(String(o.label ?? "")).slice(0, 50),
            priceAdjustCents: Math.round(Number(o.priceAdjustCents) || 0),
            inStock: Boolean(o.inStock ?? true),
          })),
        })).filter((g) => g.name && g.options.some((o) => o.label));
      }
    } catch { /* skip */ }
  }

  if (!title || !Number.isFinite(priceCents) || priceCents <= 0) {
    return { ok: false, error: "Please provide a valid title and price." };
  }
  if (priceCents <= 0) return { ok: false, error: "Price must be greater than zero." };
  if (priceCents > 10000000) return { ok: false, error: "Price cannot exceed $100,000." };
  if (stockQuantity !== null && stockQuantity < 0) return { ok: false, error: "Stock quantity cannot be negative." };
  if (processingTimeMaxDays !== null && processingTimeMaxDays > 365) return { ok: false, error: "Processing time cannot exceed 365 days." };

  // Guard ownership
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
  });
  if (!listing) return { ok: false, error: "Not allowed" };

  // Check if substantive content changed (triggers AI re-review for ACTIVE listings)
  const titleChanged = title !== listing.title;
  const descChanged = description !== listing.description;
  const categoryChanged = (category ?? null) !== (listing.category ?? null);
  const priceRatio = listing.priceCents > 0 ? Math.abs(priceCents - listing.priceCents) / listing.priceCents : 0;
  const priceChanged = priceRatio > 0.5; // >50% price change
  const substantiveChange = titleChanged || descChanged || categoryChanged || priceChanged;

  await prisma.listing.update({
    where: { id: listingId },
    data: {
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
    },
  });

  // Update variants — delete existing and recreate
  await prisma.listingVariantGroup.deleteMany({ where: { listingId } });
  for (let gi = 0; gi < variantGroups.length; gi++) {
    const g = variantGroups[gi];
    if (!g.name || g.options.length === 0) continue;
    await prisma.listingVariantGroup.create({
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

  // Re-trigger AI review if ACTIVE listing had substantive content changes
  if (listing.status === "ACTIVE" && substantiveChange) {
    try {
      const seller = await prisma.sellerProfile.findFirst({
        where: { listings: { some: { id: listingId } } },
        select: { id: true, displayName: true, chargesEnabled: true, _count: { select: { listings: true } } },
      });
      // If seller lost chargesEnabled, revert listing to DRAFT
      if (!seller?.chargesEnabled) {
        await prisma.listing.update({ where: { id: listingId }, data: { status: "DRAFT" } });
        return { ok: true };
      }
      const photos = await prisma.photo.findMany({
        where: { listingId },
        select: { url: true },
        orderBy: { sortOrder: "asc" },
        take: 4,
      });
      const { reviewListingWithAI } = await import("@/lib/ai-review");
      const aiResult = await reviewListingWithAI({
        sellerId: seller?.id ?? "",
        title,
        description,
        priceCents,
        category: category ?? null,
        tags,
        sellerName: seller?.displayName ?? "Unknown",
        listingCount: seller?._count.listings ?? 0,
        imageUrls: photos.map((p) => p.url),
      }).catch(() => ({ approved: false, flags: ["AI review error"] as string[], confidence: 0, reason: "AI error — sending to admin review" }));

      if (!aiResult.approved || aiResult.flags.length > 0 || aiResult.confidence < 0.8) {
        await prisma.listing.update({
          where: { id: listingId },
          data: {
            status: "PENDING_REVIEW",
            aiReviewFlags: aiResult.flags,
            aiReviewScore: aiResult.confidence,
          },
        });
      }
    } catch { /* non-fatal — listing stays ACTIVE on AI review error */ }
  }

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath("/dashboard");
  revalidatePath("/browse");

  redirect(`/listing/${listingId}`);
}


async function reorderPhotos(listingId: string, photoIds: string[]) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
  });
  if (!listing) return;

  await Promise.all(
    photoIds.map((id, i) =>
      prisma.photo.update({ where: { id }, data: { sortOrder: i } })
    )
  );

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath("/browse");
  revalidatePath("/dashboard");
}

async function deletePhotoAction(listingId: string, photoId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const ok = await prisma.photo.findFirst({
    where: { id: photoId, listing: { seller: { user: { clerkId: userId } } } },
  });
  if (!ok) return;

  await prisma.photo.delete({ where: { id: photoId } });

  // Re-trigger AI review if listing is ACTIVE (image removed)
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (listing?.status === "ACTIVE") {
    try {
      const currentPhotos = await prisma.photo.findMany({
        where: { listingId },
        select: { url: true },
        orderBy: { sortOrder: "asc" },
        take: 4,
      });
      const seller = await prisma.sellerProfile.findFirst({
        where: { listings: { some: { id: listingId } } },
        select: { id: true, displayName: true, chargesEnabled: true, _count: { select: { listings: true } } },
      });
      if (!seller?.chargesEnabled) {
        await prisma.listing.update({ where: { id: listingId }, data: { status: "DRAFT" } });
        return;
      }
      const { reviewListingWithAI } = await import("@/lib/ai-review");
      const aiResult = await reviewListingWithAI({
        sellerId: seller?.id ?? "",
        title: listing.title,
        description: listing.description,
        priceCents: listing.priceCents,
        category: listing.category ?? null,
        tags: listing.tags,
        sellerName: seller?.displayName ?? "Unknown",
        listingCount: seller?._count.listings ?? 0,
        imageUrls: currentPhotos.map((p) => p.url),
      }).catch(() => ({ approved: false, flags: ["AI review error"] as string[], confidence: 0, reason: "AI error" }));

      if (!aiResult.approved || aiResult.flags.length > 0 || aiResult.confidence < 0.8) {
        await prisma.listing.update({
          where: { id: listingId },
          data: { status: "PENDING_REVIEW", aiReviewFlags: aiResult.flags, aiReviewScore: aiResult.confidence },
        });
      }
    } catch { /* non-fatal */ }
  }

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
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

  for (const [photoId, text] of Object.entries(altTexts)) {
    await prisma.photo.update({
      where: { id: photoId },
      data: { altText: text.trim() || null },
    });
  }

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
}

export default async function EditListingPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

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
    },
  });
  if (!listing) return notFound();

  const remaining = Math.max(0, 8 - listing.photos.length);

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">Edit listing</h1>

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

      <ActionForm action={updateListing.bind(null, id)} className="space-y-4 mb-10">
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Title</label>
          <InputCharCounter name="title" maxLength={100} defaultValue={listing.title} required />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Price (USD)</label>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0"
            defaultValue={(listing.priceCents / 100).toFixed(2)}
            required
            className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">Tags</label>
          <TagsInput initial={listing.tags ?? []} />
        </div>

        {/* Listing type */}
        <div className="card-section p-4">
          <div className="text-sm font-medium text-neutral-700 mb-2">Listing type</div>
          <ListingTypeFields
            listingType={listing.listingType}
            minDays={listing.processingTimeMinDays}
            maxDays={listing.processingTimeMaxDays}
            stockQuantity={listing.stockQuantity}
            shipsWithinDays={listing.shipsWithinDays}
            category={listing.category}
          />
        </div>

        {/* Variants */}
        <div className="card-section p-4">
          <VariantEditor
            initialGroups={listing.variantGroups.map((g) => ({
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
        </div>

        {/* Packaged dims/weight */}
        <div className="card-section p-4">
          <label className="block text-sm font-medium text-neutral-700 mb-2">Packaged dimensions (cm / g)</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="packagedLengthCm" type="number" step="0.1" placeholder="Length (cm)"
                   defaultValue={listing.packagedLengthCm ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="packagedWidthCm" type="number" step="0.1" placeholder="Width (cm)"
                   defaultValue={listing.packagedWidthCm ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="packagedHeightCm" type="number" step="0.1" placeholder="Height (cm)"
                   defaultValue={listing.packagedHeightCm ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="packagedWeightGrams" type="number" step="1" placeholder="Weight (g)"
                   defaultValue={listing.packagedWeightGrams ?? ""} className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
          </div>
          <p className="text-xs text-neutral-400 mt-1">
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
            <span className="text-neutral-400 ml-1 font-normal">
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
            className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm"
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
              defaultValue={listing.productLengthIn ?? ""}
              placeholder="Length" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="productWidthIn" type="number" step="0.1" min="0"
              defaultValue={listing.productWidthIn ?? ""}
              placeholder="Width" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
            <input name="productHeightIn" type="number" step="0.1" min="0"
              defaultValue={listing.productHeightIn ?? ""}
              placeholder="Height" className="w-full border border-neutral-200 rounded-md px-3 py-2 text-sm" />
          </div>
          <p className="text-xs text-neutral-400 mt-1">The actual product size, not the shipping package.</p>
        </div>

        <SubmitButton>Save changes</SubmitButton>
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
          photos={listing.photos.map((p) => ({ id: p.id, url: p.url, altText: p.altText }))}
          listingId={id}
          onReorder={reorderPhotos.bind(null, id)}
          onDelete={deletePhotoAction.bind(null, id)}
          onSaveAltTexts={saveAltTextsAction.bind(null, id)}
        />
      </section>
    </main>
  );
}








