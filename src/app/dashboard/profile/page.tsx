// src/app/dashboard/profile/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";

async function saveProfile(formData: FormData) {
  "use server";

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/profile");

  const displayName = String(formData.get("displayName") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();

  if (!displayName) {
    throw new Error("Display name is required.");
  }

  // Ensure seller row exists for this user, then update it
  const { seller } = await ensureSeller();

  await prisma.sellerProfile.update({
    where: { id: seller.id },
    data: {
      displayName,
      bio: bio || null,
      city: city || null,
      state: state || null,
    },
  });

  revalidatePath("/dashboard/profile");
  redirect("/dashboard/profile?saved=1");
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/profile");

  // get (or create) seller row and prefill the form
  const { seller } = await ensureSeller();

  const sp = await searchParams;
  const saved = sp?.saved === "1";

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Your Seller Profile</h1>

      {saved && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-green-800">
          Saved!
        </div>
      )}

      <form action={saveProfile} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Display name</label>
          <input
            name="displayName"
            defaultValue={seller.displayName ?? ""}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Bio</label>
          <textarea
            name="bio"
            rows={4}
            defaultValue={seller.bio ?? ""}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">City</label>
            <input
              name="city"
              defaultValue={seller.city ?? ""}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">State</label>
            <input
              name="state"
              defaultValue={seller.state ?? ""}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <button type="submit" className="rounded px-4 py-2 bg-black text-white">
          Save
        </button>
      </form>
    </main>
  );
}
