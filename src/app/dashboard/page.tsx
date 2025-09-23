// src/app/dashboard/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ensureUser } from "@/lib/ensureUser";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const me = await ensureUser();

  return (
    <main className="p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Welcome{me?.name ? `, ${me.name}` : ""} 👋</h1>
      <div className="text-sm text-neutral-600">
        Signed in as <span className="font-mono">{me?.email}</span>
      </div>
      {/* Replace this with real widgets next */}
    </main>
  );
}








