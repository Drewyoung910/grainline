// src/app/dashboard/profile/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import ProfileBannerUploader from "@/components/ProfileBannerUploader";
import ProfileAvatarUploader from "@/components/ProfileAvatarUploader";
import ProfileWorkshopUploader from "@/components/ProfileWorkshopUploader";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };
import CharCounter from "@/components/CharCounter";
import ConfirmButton from "@/components/ConfirmButton";
import RemoveAvatarButton from "./RemoveAvatarButton";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";

// ──────────────────────────────────────────────────────────────────────────────
// Server actions
// ──────────────────────────────────────────────────────────────────────────────

async function updateSellerProfile(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/profile");
  const { seller } = await ensureSeller();

  function toNull(v: FormDataEntryValue | null): string | null {
    const s = typeof v === "string" ? v.trim() : null;
    return s === "" || s === null ? null : s;
  }
  function toInt(v: FormDataEntryValue | null): number | null {
    const s = typeof v === "string" ? v.trim() : "";
    if (s === "") return null;
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  }
  function toBool(v: FormDataEntryValue | null): boolean {
    return String(v ?? "") === "on";
  }

  const displayNameRaw = (String(formData.get("displayName") ?? "")).trim();
  if (!displayNameRaw) throw new Error("Display name is required.");
  const displayName = sanitizeText(displayNameRaw);

  const taglineRaw = toNull(formData.get("tagline"));
  const tagline = taglineRaw ? sanitizeText(taglineRaw) : null;
  const bioRaw = toNull(formData.get("bio"));
  const bio = bioRaw ? sanitizeRichText(bioRaw) : null;
  const storyTitleRaw = toNull(formData.get("storyTitle"));
  const storyTitle = storyTitleRaw ? sanitizeText(storyTitleRaw) : null;
  const storyBodyRaw = toNull(formData.get("storyBody"));
  const storyBody = storyBodyRaw ? sanitizeRichText(storyBodyRaw) : null;
  const yearsInBusiness = toInt(formData.get("yearsInBusiness"));

  const bannerImageUrl = toNull(formData.get("bannerImageUrl"));
  const avatarImageUrl = toNull(formData.get("avatarImageUrl"));
  const workshopImageUrl = toNull(formData.get("workshopImageUrl"));

  const instagramUrl = toNull(formData.get("instagramUrl"));
  const facebookUrl = toNull(formData.get("facebookUrl"));
  const pinterestUrl = toNull(formData.get("pinterestUrl"));
  const tiktokUrl = toNull(formData.get("tiktokUrl"));
  const websiteUrl = toNull(formData.get("websiteUrl"));

  const returnPolicyRaw = toNull(formData.get("returnPolicy"));
  const returnPolicy = returnPolicyRaw ? sanitizeRichText(returnPolicyRaw) : null;
  const customOrderPolicyRaw = toNull(formData.get("customOrderPolicy"));
  const customOrderPolicy = customOrderPolicyRaw ? sanitizeRichText(customOrderPolicyRaw) : null;
  const shippingPolicyRaw = toNull(formData.get("shippingPolicy"));
  const shippingPolicy = shippingPolicyRaw ? sanitizeRichText(shippingPolicyRaw) : null;

  const acceptsCustomOrders = toBool(formData.get("acceptsCustomOrders"));
  const acceptingNewOrders = toBool(formData.get("acceptingNewOrders"));
  const customOrderTurnaroundDays = toInt(formData.get("customOrderTurnaroundDays"));

  const offersGiftWrapping = toBool(formData.get("offersGiftWrapping"));
  const giftWrappingPriceDollars = toNull(formData.get("giftWrappingPriceCents"));
  const giftWrappingPriceCentsRaw =
    giftWrappingPriceDollars !== null
      ? Math.round(parseFloat(giftWrappingPriceDollars) * 100)
      : null;
  const giftWrappingPriceCents =
    giftWrappingPriceCentsRaw !== null
      ? Math.max(0, Math.min(10000, giftWrappingPriceCentsRaw))
      : null;

  // Soft uniqueness check — warn (don't block) if another seller has the same name
  const duplicate = await prisma.sellerProfile.findFirst({
    where: {
      displayName: { equals: displayName, mode: "insensitive" },
      id: { not: seller.id },
    },
    select: { id: true },
  });

  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: {
      displayName,
      tagline,
      bio,
      storyTitle,
      storyBody,
      yearsInBusiness,
      bannerImageUrl,
      avatarImageUrl,
      workshopImageUrl,
      instagramUrl,
      facebookUrl,
      pinterestUrl,
      tiktokUrl,
      websiteUrl,
      returnPolicy,
      customOrderPolicy,
      shippingPolicy,
      acceptsCustomOrders,
      acceptingNewOrders,
      customOrderTurnaroundDays,
      offersGiftWrapping,
      giftWrappingPriceCents: offersGiftWrapping ? giftWrappingPriceCents : null,
    },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath(`/seller/${seller.id}`);

  if (duplicate) {
    redirect("/dashboard/profile?warning=duplicate-name");
  }
}

async function addFaq(formData: FormData) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;
  const { seller } = await ensureSeller();

  const question = (String(formData.get("question") ?? "")).trim();
  const answer = (String(formData.get("answer") ?? "")).trim();
  if (!question || !answer) return;

  const last = await prisma.sellerFaq.findFirst({
    where: { sellerProfileId: seller.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  await prisma.sellerFaq.create({
    data: {
      sellerProfileId: seller.id,
      question,
      answer,
      sortOrder: (last?.sortOrder ?? 0) + 1,
    },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath(`/seller/${seller.id}`);
}

async function deleteFaq(faqId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;
  const { seller } = await ensureSeller();

  await prisma.sellerFaq.deleteMany({
    where: { id: faqId, sellerProfileId: seller.id },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath(`/seller/${seller.id}`);
}

async function removeSellerAvatar() {
  "use server";
  const { userId } = await auth();
  if (!userId) return;
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return;
  await prisma.sellerProfile.update({ where: { userId: me.id }, data: { avatarImageUrl: null } });
  revalidatePath("/dashboard/profile");
}

async function toggleFeaturedListing(listingId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) return;
  const { seller } = await ensureSeller();

  // Verify seller owns the listing before featuring it
  const owned = await prisma.listing.count({ where: { id: listingId, sellerId: seller.id } });
  if (owned === 0) return;

  // Re-fetch to get current featuredListingIds
  const freshSeller = await prisma.sellerProfile.findUnique({
    where: { id: seller.id },
    select: { featuredListingIds: true },
  });
  const current = freshSeller?.featuredListingIds ?? [];
  let next: string[];
  if (current.includes(listingId)) {
    next = current.filter((id) => id !== listingId);
  } else {
    if (current.length >= 6) return; // max 6
    next = [...current, listingId];
  }

  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: { featuredListingIds: next },
  });

  revalidatePath("/dashboard/profile");
  revalidatePath(`/seller/${seller.id}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────────

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ warning?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/profile");

  const { seller } = await ensureSeller();

  const [fullSeller, activeListings] = await Promise.all([
    prisma.sellerProfile.findUnique({
      where: { id: seller.id },
      include: { faqs: { orderBy: { sortOrder: "asc" } }, user: { select: { imageUrl: true } } },
    }),
    prisma.listing.findMany({
      where: { sellerId: seller.id, status: "ACTIVE" },
      include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!fullSeller) redirect("/dashboard");

  const sp = await searchParams;
  const featured = new Set(fullSeller.featuredListingIds ?? []);

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-10">
      {sp.warning === "duplicate-name" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Another maker already uses this display name. Consider adding your location
          or specialty to stand out (e.g. &quot;Oak &amp; Iron Woodworks — Austin&quot;).
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shop Profile</h1>
        <Link
          href={`/seller/${seller.id}`}
          target="_blank"
          className="text-sm underline text-neutral-600"
        >
          View public profile
        </Link>
      </div>

      <form action={updateSellerProfile} className="space-y-10">
        {/* ── A. Shop Identity ─────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium border-b border-neutral-100 pb-2">Shop Identity</h2>

          <div>
            <label className="block text-sm font-medium mb-2">Profile avatar</label>
            <ProfileAvatarUploader key={fullSeller.avatarImageUrl ?? "none"} initialUrl={fullSeller.avatarImageUrl} />
            {fullSeller.avatarImageUrl && (
              <div className="mt-2">
                <RemoveAvatarButton action={removeSellerAvatar} />
              </div>
            )}
            <div className="mt-3 flex items-center gap-3">
              {fullSeller.user?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fullSeller.user.imageUrl} alt="Manage Account photo" className="h-10 w-10 rounded-full object-cover border border-neutral-200" />
              ) : (
                <div className="h-10 w-10 rounded-full bg-neutral-200 border border-neutral-200 shrink-0" />
              )}
              <p className="text-xs text-neutral-500">
                <span className="font-medium">Current photo from Manage Account</span> — used as fallback if no custom photo is uploaded above.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Banner image</label>
            <p className="text-xs text-neutral-500 mb-2">
              Displayed at the top of your public profile. Ideal size: 1200×300.
            </p>
            <ProfileBannerUploader initialUrl={fullSeller.bannerImageUrl} />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Display name <span className="text-red-500">*</span>
            </label>
            <input
              name="displayName"
              required
              defaultValue={fullSeller.displayName}
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Tagline</label>
            <input
              name="tagline"
              maxLength={100}
              defaultValue={fullSeller.tagline ?? ""}
              placeholder="e.g. Hand-crafting heirloom pieces in Austin since 2018"
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Years in business</label>
            <input
              type="number"
              name="yearsInBusiness"
              min={0}
              max={200}
              defaultValue={fullSeller.yearsInBusiness ?? ""}
              className="w-40 border rounded px-3 py-2"
            />
          </div>
        </section>

        {/* ── B. Your Story ─────────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium border-b border-neutral-100 pb-2">Your Story</h2>

          <div>
            <label className="block text-sm font-medium mb-1">Bio</label>
            <CharCounter
              name="bio"
              maxLength={500}
              rows={4}
              defaultValue={fullSeller.bio ?? ""}
              placeholder="Tell buyers a bit about yourself and your craft."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Story title</label>
            <input
              name="storyTitle"
              defaultValue={fullSeller.storyTitle ?? ""}
              placeholder="e.g. How I got into woodworking"
              className="w-full border rounded px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Story</label>
            <CharCounter
              name="storyBody"
              maxLength={2000}
              rows={8}
              defaultValue={fullSeller.storyBody ?? ""}
              placeholder="Share your full story with buyers..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Workshop photo</label>
            <p className="text-xs text-neutral-500 mb-2">
              A photo of your workspace or tools.
            </p>
            <ProfileWorkshopUploader initialUrl={fullSeller.workshopImageUrl} />
          </div>
        </section>

        {/* ── C. Social Links ───────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium border-b border-neutral-100 pb-2">Social Links</h2>

          {(
            [
              ["instagramUrl", "Instagram", "https://instagram.com/yourhandle"],
              ["facebookUrl", "Facebook", "https://facebook.com/yourpage"],
              ["pinterestUrl", "Pinterest", "https://pinterest.com/yourprofile"],
              ["tiktokUrl", "TikTok", "https://tiktok.com/@yourhandle"],
              ["websiteUrl", "Website", "https://yourwebsite.com"],
            ] as const
          ).map(([field, label, placeholder]) => (
            <div key={field}>
              <label className="block text-sm font-medium mb-1">{label}</label>
              <input
                name={field}
                type="url"
                defaultValue={(fullSeller[field] as string | null) ?? ""}
                placeholder={placeholder}
                className="w-full border rounded px-3 py-2"
              />
            </div>
          ))}
        </section>

        {/* ── D. Shop Policies ──────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium border-b border-neutral-100 pb-2">Shop Policies</h2>

          <div>
            <label className="block text-sm font-medium mb-1">Return policy</label>
            <textarea
              name="returnPolicy"
              rows={4}
              defaultValue={fullSeller.returnPolicy ?? ""}
              className="w-full border rounded px-3 py-2"
              placeholder="Describe your return / refund policy..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Custom order policy</label>
            <textarea
              name="customOrderPolicy"
              rows={4}
              defaultValue={fullSeller.customOrderPolicy ?? ""}
              className="w-full border rounded px-3 py-2"
              placeholder="Describe how you handle custom orders..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Shipping policy</label>
            <textarea
              name="shippingPolicy"
              rows={4}
              defaultValue={fullSeller.shippingPolicy ?? ""}
              className="w-full border rounded px-3 py-2"
              placeholder="Describe your shipping timelines, carriers, etc."
            />
          </div>
        </section>

        {/* ── E. Custom Orders & Availability ───────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium border-b border-neutral-100 pb-2">Custom Orders &amp; Availability</h2>

          <div className="flex items-center gap-2">
            <input
              id="acceptsCustomOrders"
              name="acceptsCustomOrders"
              type="checkbox"
              defaultChecked={fullSeller.acceptsCustomOrders}
            />
            <label htmlFor="acceptsCustomOrders" className="text-sm">
              I accept custom orders
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="acceptingNewOrders"
              name="acceptingNewOrders"
              type="checkbox"
              defaultChecked={fullSeller.acceptingNewOrders}
            />
            <label htmlFor="acceptingNewOrders" className="text-sm">
              Currently accepting new orders
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Custom order turnaround (days)
            </label>
            <input
              type="number"
              name="customOrderTurnaroundDays"
              min={1}
              defaultValue={fullSeller.customOrderTurnaroundDays ?? ""}
              className="w-40 border rounded px-3 py-2"
            />
          </div>
        </section>

        {/* ── F. Gift Wrapping ───────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-lg font-medium border-b border-neutral-100 pb-2">Gift Wrapping</h2>

          <div className="flex items-center gap-2">
            <input
              id="offersGiftWrapping"
              name="offersGiftWrapping"
              type="checkbox"
              defaultChecked={fullSeller.offersGiftWrapping}
            />
            <label htmlFor="offersGiftWrapping" className="text-sm">
              I offer gift wrapping
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Gift wrapping price (USD)
            </label>
            <input
              type="number"
              name="giftWrappingPriceCents"
              step="0.01"
              min={0}
              defaultValue={
                fullSeller.giftWrappingPriceCents != null
                  ? (fullSeller.giftWrappingPriceCents / 100).toFixed(2)
                  : ""
              }
              placeholder="e.g. 5.00"
              className="w-40 border rounded px-3 py-2"
            />
          </div>
        </section>

        <div>
          <button
            type="submit"
            className="rounded px-6 py-2 bg-black text-white hover:bg-neutral-800"
          >
            Save profile
          </button>
        </div>
      </form>

      {/* ── FAQs ───────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium border-b border-neutral-100 pb-2">FAQs</h2>

        {fullSeller.faqs.length === 0 ? (
          <p className="text-sm text-neutral-500">No FAQs yet.</p>
        ) : (
          <ul className="space-y-3">
            {fullSeller.faqs.map((faq) => (
              <li
                key={faq.id}
                className="card-section p-4 flex items-start justify-between gap-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{faq.question}</p>
                  <p className="text-sm text-neutral-600 mt-1">{faq.answer}</p>
                </div>
                <form action={deleteFaq.bind(null, faq.id)}>
                  <button
                    type="submit"
                    className="text-xs text-red-600 border border-red-200 rounded px-2 py-1 hover:bg-red-50 shrink-0"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {/* Add FAQ form */}
        <form action={addFaq} className="space-y-3 card-section p-4">
          <h3 className="text-sm font-medium">Add a FAQ</h3>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Question</label>
            <input
              name="question"
              required
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="e.g. Do you ship internationally?"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">Answer</label>
            <textarea
              name="answer"
              required
              rows={3}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Your answer..."
            />
          </div>
          <button
            type="submit"
            className="rounded px-4 py-1.5 bg-black text-white text-sm hover:bg-neutral-800"
          >
            Add FAQ
          </button>
        </form>
      </section>

      {/* ── Featured Listings ──────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium border-b border-neutral-100 pb-2">Featured Listings</h2>
          <p className="text-sm text-neutral-500 mt-1">
            Select up to 6 active listings to feature at the top of your profile.
          </p>
        </div>

        {activeListings.length === 0 ? (
          <p className="text-sm text-neutral-500">No active listings yet.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {activeListings.map((listing) => {
              const isFeatured = featured.has(listing.id);
              const thumb = listing.photos[0]?.url ?? null;
              return (
                <li
                  key={listing.id}
                  className={`relative card-listing ${
                    isFeatured ? "ring-2 ring-amber-400" : ""
                  }`}
                >
                  {isFeatured && (
                    <span className="absolute top-2 left-2 z-10 bg-amber-400 text-amber-900 text-xs font-medium px-2 py-0.5 rounded-full">
                      Featured
                    </span>
                  )}
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt={listing.title}
                      className="h-32 w-full object-cover"
                    />
                  ) : (
                    <div className="h-32 w-full bg-neutral-100" />
                  )}
                  <div className="p-3">
                    <p className="text-xs font-medium truncate">{listing.title}</p>
                    <form action={toggleFeaturedListing.bind(null, listing.id)} className="mt-2">
                      <button
                        type="submit"
                        className={`text-xs rounded px-2 py-1 border ${
                          isFeatured
                            ? "text-amber-700 border-amber-300 hover:bg-amber-50"
                            : "text-neutral-600 border-neutral-200 hover:bg-neutral-50"
                        }`}
                        disabled={!isFeatured && featured.size >= 6}
                      >
                        {isFeatured ? "Unfeature" : "Feature"}
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
