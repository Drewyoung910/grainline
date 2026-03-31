// src/app/account/feed/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import FeedClient from "./FeedClient";

export const metadata: Metadata = {
  title: "Your Feed",
};

export default async function FeedPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account/feed");

  return (
    <main>
      <FeedClient />
    </main>
  );
}
