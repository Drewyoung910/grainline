// src/app/dashboard/listings/[id]/edit/page.tsx
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import AddPhotosButton from "@/components/AddPhotosButton";
import ActionForm, { SubmitButton } from "@/components/ActionForm";
import TagsInput from "@/components/TagsInput";
import ListingTypeFields from "@/components/ListingTypeFields";
import type { Category, ListingType } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";

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

  if (!title || !Number.isFinite(priceCents) || priceCents < 0) {
    return { ok: false, error: "Please provide a valid title and price." };
  }
  if (priceCents < 0) return { ok: false, error: "Price cannot be negative." };
  if (priceCents > 10000000) return { ok: false, error: "Price cannot exceed $100,000." };
  if (stockQuantity !== null && stockQuantity < 0) return { ok: false, error: "Stock quantity cannot be negative." };
  if (processingTimeMaxDays !== null && processingTimeMaxDays > 365) return { ok: false, error: "Processing time cannot exceed 365 days." };

  // Guard ownership
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
  });
  if (!listing) return { ok: false, error: "Not allowed" };

  await prisma.listing.update({
    where: { id: listingId },
    data: {
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
    },
  });

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath("/dashboard");
  revalidatePath("/browse");

  return { ok: true };
}

async function deletePhoto(photoId: string, listingId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  // Guard ownership
  const ok = await prisma.photo.findFirst({
    where: { id: photoId, listing: { seller: { user: { clerkId: userId } } } },
  });
  if (!ok) return;

  await prisma.photo.delete({ where: { id: photoId } });

  // Repack sortOrder to keep it contiguous
  const photos = await prisma.photo.findMany({
    where: { listingId },
    orderBy: { sortOrder: "asc" },
  });
  await Promise.all(
    photos.map((p, i) =>
      prisma.photo.update({ where: { id: p.id }, data: { sortOrder: i } })
    )
  );

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath("/dashboard");
}

async function setCoverPhoto(listingId: string, photoId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;

  const listing = await prisma.listing.findFirst({
    where: { id: listingId, seller: { user: { clerkId: userId } } },
  });
  if (!listing) return;

  const photos = await prisma.photo.findMany({
    where: { listingId },
    orderBy: { sortOrder: "asc" },
  });

  const pick = photos.find((p) => p.id === photoId);
  if (!pick) return;

  const reordered = [pick, ...photos.filter((p) => p.id !== photoId)];
  await Promise.all(
    reordered.map((p, i) =>
      prisma.photo.update({ where: { id: p.id }, data: { sortOrder: i } })
    )
  );

  revalidatePath(`/dashboard/listings/${listingId}/edit`);
  revalidatePath(`/listing/${listingId}`);
  revalidatePath("/browse");
  revalidatePath("/dashboard");
}

export default async function EditListingPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: { photos: { orderBy: { sortOrder: "asc" } } },
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
          <label className="block text-sm mb-1">Title</label>
          <input
            name="title"
            defaultValue={listing.title}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Price (USD)</label>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0"
            defaultValue={(listing.priceCents / 100).toFixed(2)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Tags</label>
          <TagsInput initial={listing.tags ?? []} />
        </div>

        {/* Listing type */}
        <div className="border rounded p-3">
          <div className="font-medium mb-2">Listing type</div>
          <ListingTypeFields
            listingType={listing.listingType}
            minDays={listing.processingTimeMinDays}
            maxDays={listing.processingTimeMaxDays}
            stockQuantity={listing.stockQuantity}
            shipsWithinDays={listing.shipsWithinDays}
            category={listing.category}
          />
        </div>

        {/* Packaged dims/weight */}
        <div>
          <label className="block text-sm font-medium mb-2">Packaged dimensions (cm / g)</label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input name="packagedLengthCm" type="number" step="0.1" placeholder="Length (cm)"
                   defaultValue={listing.packagedLengthCm ?? ""} className="w-full border rounded px-3 py-2" />
            <input name="packagedWidthCm" type="number" step="0.1" placeholder="Width (cm)"
                   defaultValue={listing.packagedWidthCm ?? ""} className="w-full border rounded px-3 py-2" />
            <input name="packagedHeightCm" type="number" step="0.1" placeholder="Height (cm)"
                   defaultValue={listing.packagedHeightCm ?? ""} className="w-full border rounded px-3 py-2" />
            <input name="packagedWeightGrams" type="number" step="1" placeholder="Weight (g)"
                   defaultValue={listing.packagedWeightGrams ?? ""} className="w-full border rounded px-3 py-2" />
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            These should be the finished, ready-to-ship package size/weight per unit.
            If left blank, your seller default package will be used.
          </p>
        </div>

        <div>
          <label className="block text-sm mb-1">Description</label>
          <textarea
            name="description"
            rows={4}
            defaultValue={listing.description ?? ""}
            className="w-full border rounded px-3 py-2"
          />
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

        {listing.photos.length === 0 ? (
          <p className="text-sm text-gray-500">No photos yet.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {listing.photos.map((p, idx) => (
              <li key={p.id} className="rounded border overflow-hidden">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-32 w-full object-cover" />
                  {idx === 0 && (
                    <span className="absolute left-2 top-2 rounded bg-black/80 px-2 py-0.5 text-xs text-white">
                      Cover
                    </span>
                  )}
                </div>

                <div className="p-2 flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2">
                    <form action={setCoverPhoto.bind(null, id, p.id)}>
                      <button
                        className="rounded border px-2 py-1 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={idx === 0}
                        title={idx === 0 ? "Already cover" : "Make cover"}
                      >
                        Make cover
                      </button>
                    </form>
                  </div>

                  <form action={deletePhoto.bind(null, p.id, id)}>
                    <button className="rounded border px-2 py-1 hover:bg-red-50 text-red-600 border-red-300">
                      Remove
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}








