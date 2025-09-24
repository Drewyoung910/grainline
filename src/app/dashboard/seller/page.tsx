// src/app/dashboard/seller/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { revalidatePath } from "next/cache";

async function updateSellerProfile(formData: FormData) {
  "use server";

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/seller");

  const { seller } = await ensureSeller();

  const displayName = String(formData.get("displayName") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim() || null;
  const state = String(formData.get("state") ?? "").trim() || null;
  const bio = String(formData.get("bio") ?? "").trim() || null;

  if (!displayName) {
    throw new Error("Display name is required.");
  }

  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: { displayName, city, state, bio },
  });

  // Make sure the public seller page reflects changes
  revalidatePath(`/seller/${seller.id}`);
  // Back to public profile
  redirect(`/seller/${seller.id}`);
}

export default async function SellerSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/seller");

  const { seller } = await ensureSeller();

  // Refresh the latest row for default values
  const row = await prisma.sellerProfile.findUnique({
    where: { id: seller.id },
  });

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Seller profile</h1>

      <form action={updateSellerProfile} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Display name</label>
          <input
            name="displayName"
            required
            defaultValue={row?.displayName ?? ""}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">City</label>
            <input
              name="city"
              defaultValue={row?.city ?? ""}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">State</label>
            <input
              name="state"
              defaultValue={row?.state ?? ""}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1">Bio</label>
          <textarea
            name="bio"
            rows={5}
            defaultValue={row?.bio ?? ""}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <button type="submit" className="rounded px-4 py-2 bg-black text-white">
          Save
        </button>
      </form>
    </main>
  );
}
