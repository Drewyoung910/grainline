// src/app/dashboard/listings/custom/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { createNotification } from "@/lib/notifications";
import { sendCustomOrderReady } from "@/lib/email";
import ImagesUploader from "@/components/ImagesUploader";
import ListingTypeFields from "@/components/ListingTypeFields";
import type { ListingType } from "@prisma/client";

// unit converters
const inToCm = (v: number) => Math.round((v * 2.54 + Number.EPSILON) * 100) / 100;
const lbToG = (v: number) => Math.round(v * 453.59237);

async function createCustomListing(formData: FormData) {
  "use server";

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard");

  const { me, seller } = await ensureSeller();

  const conversationId = String(formData.get("conversationId") ?? "").trim();
  const reservedForUserId = String(formData.get("reservedForUserId") ?? "").trim();

  if (!conversationId || !reservedForUserId) {
    throw new Error("Missing conversation or buyer context.");
  }

  // Verify seller is a participant in this conversation
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, OR: [{ userAId: me.id }, { userBId: me.id }] },
    select: { id: true },
  });
  if (!convo) throw new Error("Conversation not found.");

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const priceStr = String(formData.get("price") ?? "0");
  const priceCents = Math.round(parseFloat(priceStr) * 100);

  if (!title || !Number.isFinite(priceCents) || priceCents <= 0) {
    throw new Error("Please fill title and price.");
  }

  // Photos (optional for custom listings)
  let imageUrls: string[] = [];
  const json = formData.get("imageUrlsJson");
  if (typeof json === "string" && json.length) {
    try {
      imageUrls = (JSON.parse(json) as string[]).filter(Boolean);
    } catch {}
  }
  if (imageUrls.length === 0) {
    imageUrls = formData.getAll("imageUrls").map(String).filter(Boolean);
  }
  imageUrls = imageUrls.slice(0, 8);

  // Packaged dims
  const lenIn = Number(String(formData.get("pkgLengthIn") ?? "").trim());
  const widIn = Number(String(formData.get("pkgWidthIn") ?? "").trim());
  const hgtIn = Number(String(formData.get("pkgHeightIn") ?? "").trim());
  const wtLb = Number(String(formData.get("pkgWeightLb") ?? "").trim());

  const packagedLengthCm = Number.isFinite(lenIn) && lenIn > 0 ? inToCm(lenIn) : null;
  const packagedWidthCm = Number.isFinite(widIn) && widIn > 0 ? inToCm(widIn) : null;
  const packagedHeightCm = Number.isFinite(hgtIn) && hgtIn > 0 ? inToCm(hgtIn) : null;
  const packagedWeightGrams = Number.isFinite(wtLb) && wtLb > 0 ? lbToG(wtLb) : null;

  // Listing type
  const listingTypeRaw = String(formData.get("listingType") ?? "MADE_TO_ORDER");
  const listingType: ListingType = listingTypeRaw === "IN_STOCK" ? "IN_STOCK" : "MADE_TO_ORDER";
  const stockQuantityRaw = parseInt(String(formData.get("stockQuantity") ?? ""), 10);
  const stockQuantity =
    listingType === "IN_STOCK" && Number.isFinite(stockQuantityRaw) && stockQuantityRaw > 0
      ? stockQuantityRaw
      : null;
  const shipsWithinDaysRaw = parseInt(String(formData.get("shipsWithinDays") ?? ""), 10);
  const shipsWithinDays =
    listingType === "IN_STOCK" && Number.isFinite(shipsWithinDaysRaw) && shipsWithinDaysRaw > 0
      ? shipsWithinDaysRaw
      : null;
  const minDaysRaw = parseInt(String(formData.get("processingTimeMinDays") ?? ""), 10);
  const maxDaysRaw = parseInt(String(formData.get("processingTimeMaxDays") ?? ""), 10);
  const processingTimeMinDays =
    listingType === "MADE_TO_ORDER" && Number.isFinite(minDaysRaw) && minDaysRaw > 0
      ? minDaysRaw
      : null;
  const processingTimeMaxDays =
    listingType === "MADE_TO_ORDER" && Number.isFinite(maxDaysRaw) && maxDaysRaw > 0
      ? maxDaysRaw
      : null;

  const created = await prisma.listing.create({
    data: {
      sellerId: seller.id,
      title,
      description,
      priceCents,
      isPrivate: true,
      reservedForUserId,
      customOrderConversationId: conversationId,
      listingType,
      stockQuantity,
      shipsWithinDays,
      processingTimeMinDays,
      processingTimeMaxDays,
      packagedLengthCm,
      packagedWidthCm,
      packagedHeightCm,
      packagedWeightGrams,
      photos: { create: imageUrls.map((url, i) => ({ url, sortOrder: i })) },
    },
  });

  // Send a custom_order_link message back to the buyer
  await prisma.message.create({
    data: {
      conversationId,
      senderId: me.id,
      recipientId: reservedForUserId,
      kind: "custom_order_link",
      body: JSON.stringify({
        listingId: created.id,
        title: created.title,
        priceCents: created.priceCents,
        currency: created.currency,
      }),
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  await createNotification({
    userId: reservedForUserId,
    type: "CUSTOM_ORDER_LINK",
    title: "Your custom piece is ready to review!",
    body: `${created.title} — review and purchase`,
    link: `/listing/${created.id}`,
  });

  try {
    const buyerUser = await prisma.user.findUnique({
      where: { id: reservedForUserId },
      select: { name: true, email: true },
    });
    if (buyerUser?.email) {
      await sendCustomOrderReady({
        buyer: { name: buyerUser.name, email: buyerUser.email },
        sellerName: seller.displayName,
        listingTitle: created.title,
        priceCents: created.priceCents,
        listingId: created.id,
      });
    }
  } catch { /* non-fatal */ }

  revalidatePath(`/messages/${conversationId}`);
  redirect(`/messages/${conversationId}`);
}

export default async function CustomListingPage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; buyerId?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard");

  const { me } = await ensureSeller();
  const { conversationId, buyerId } = await searchParams;

  if (!conversationId || !buyerId) redirect("/messages");

  // Fetch conversation + find the custom order request message
  const convo = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [{ userAId: me.id }, { userBId: me.id }],
    },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!convo) redirect("/messages");

  // Find the most recent custom_order_request message from the buyer
  const requestMsg = await prisma.message.findFirst({
    where: {
      conversationId,
      senderId: buyerId,
      kind: "custom_order_request",
    },
    orderBy: { createdAt: "desc" },
    select: { body: true, createdAt: true },
  });

  let requestData: {
    description?: string;
    dimensions?: string | null;
    budget?: number | null;
    timelineLabel?: string | null;
    listingTitle?: string | null;
  } | null = null;
  if (requestMsg) {
    try {
      requestData = JSON.parse(requestMsg.body);
    } catch {}
  }

  // Fetch buyer info for display
  const buyer = await prisma.user.findUnique({
    where: { id: buyerId },
    select: { name: true, email: true },
  });

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-2">Create a Custom Listing</h1>
      <p className="text-sm text-neutral-500 mb-6">
        This listing will be private and reserved for{" "}
        <span className="font-medium">{buyer?.name || buyer?.email || "the buyer"}</span>. Once
        you create it, a link will be sent to them in the conversation.
      </p>

      {/* Buyer's request context */}
      {requestData && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="text-sm font-semibold text-amber-800">🎨 Buyer&apos;s Request</div>
          <p className="text-sm text-amber-900">{requestData.description}</p>
          {requestData.dimensions && (
            <p className="text-xs text-amber-700">
              <span className="font-medium">Dimensions:</span> {requestData.dimensions}
            </p>
          )}
          {requestData.budget && (
            <p className="text-xs text-amber-700">
              <span className="font-medium">Budget:</span> ${requestData.budget}
            </p>
          )}
          {requestData.timelineLabel && (
            <p className="text-xs text-amber-700">
              <span className="font-medium">Timeline:</span> {requestData.timelineLabel}
            </p>
          )}
          {requestData.listingTitle && (
            <p className="text-xs text-amber-700">
              <span className="font-medium">Inspired by:</span> {requestData.listingTitle}
            </p>
          )}
        </div>
      )}

      <form action={createCustomListing} className="space-y-4">
        {/* Hidden fields */}
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="reservedForUserId" value={buyerId} />

        <div>
          <label className="block text-sm mb-1">Title</label>
          <input
            name="title"
            required
            className="w-full border rounded px-3 py-2"
            placeholder="e.g. Custom walnut dining table"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Price (USD)</label>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0"
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Description</label>
          <textarea
            name="description"
            rows={4}
            className="w-full border rounded px-3 py-2 resize-none"
            placeholder="Describe what you're making and any specifics…"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Photos (optional for custom orders)</label>
          <ImagesUploader max={8} fieldName="imageUrls" />
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
              <input
                name="pkgLengthIn"
                type="number"
                step="0.1"
                min="0"
                className="w-full border rounded px-3 py-2"
                placeholder="e.g. 24"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1">Width (in)</div>
              <input
                name="pkgWidthIn"
                type="number"
                step="0.1"
                min="0"
                className="w-full border rounded px-3 py-2"
                placeholder="e.g. 12"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1">Height (in)</div>
              <input
                name="pkgHeightIn"
                type="number"
                step="0.1"
                min="0"
                className="w-full border rounded px-3 py-2"
                placeholder="e.g. 8"
              />
            </label>
            <label className="text-sm">
              <div className="mb-1">Weight (lb)</div>
              <input
                name="pkgWeightLb"
                type="number"
                step="0.1"
                min="0"
                className="w-full border rounded px-3 py-2"
                placeholder="e.g. 5.5"
              />
            </label>
          </div>
        </div>

        <button type="submit" className="rounded px-4 py-2 bg-black text-white">
          Create Custom Listing &amp; Notify Buyer
        </button>
      </form>
    </div>
  );
}
