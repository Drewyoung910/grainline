"use server";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

type ActionResult = { ok: true } | { ok: false; error: string };

function actionError(error: unknown): ActionResult {
  console.error("[onboarding action] error:", error);
  return { ok: false, error: "We couldn't save that step. Please try again." };
}

async function getSellerId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const seller = await prisma.sellerProfile.findFirst({
    where: { user: { clerkId: userId } },
    select: { id: true },
  });
  if (!seller) throw new Error("No seller profile");
  return seller.id;
}

export async function saveStep1(formData: FormData): Promise<ActionResult> {
  try {
    const sellerId = await getSellerId();
    const displayName = String(formData.get("displayName") || "").trim().slice(0, 100);
    const bio = String(formData.get("bio") || "").trim().slice(0, 500) || null;
    const tagline = String(formData.get("tagline") || "").trim().slice(0, 100) || null;
    const avatarImageUrl = String(formData.get("avatarImageUrl") || "").trim() || null;

    await prisma.sellerProfile.update({
      where: { id: sellerId },
      data: {
        ...(displayName ? { displayName } : {}),
        bio,
        tagline,
        avatarImageUrl,
        onboardingStep: 2,
      },
    });
    revalidatePath("/dashboard/onboarding");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function saveStep2(formData: FormData): Promise<ActionResult> {
  try {
    const sellerId = await getSellerId();
    const yearsRaw = formData.get("yearsInBusiness");
    const yearsNum = yearsRaw ? parseInt(String(yearsRaw), 10) : NaN;
    const yearsInBusiness = !Number.isNaN(yearsNum) ? Math.max(0, Math.min(100, yearsNum)) : null;
    const city = String(formData.get("city") || "").trim().slice(0, 100) || null;
    const state = String(formData.get("state") || "").trim().slice(0, 100) || null;
    const returnPolicy = String(formData.get("returnPolicy") || "").trim().slice(0, 2000) || null;
    const shippingPolicy = String(formData.get("shippingPolicy") || "").trim().slice(0, 2000) || null;
    const acceptsCustomOrders = formData.get("acceptsCustomOrders") === "on";

    await prisma.sellerProfile.update({
      where: { id: sellerId },
      data: {
        yearsInBusiness,
        city,
        state,
        returnPolicy,
        shippingPolicy,
        acceptsCustomOrders,
        onboardingStep: 3,
      },
    });
    revalidatePath("/dashboard/onboarding");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function advanceStep(targetStep: number): Promise<ActionResult> {
  try {
    const sellerId = await getSellerId();
    await prisma.sellerProfile.update({
      where: { id: sellerId },
      data: { onboardingStep: Math.max(0, Math.min(5, targetStep)) },
    });
    revalidatePath("/dashboard/onboarding");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function completeOnboarding(): Promise<ActionResult> {
  try {
    const sellerId = await getSellerId();
    await prisma.sellerProfile.update({
      where: { id: sellerId },
      data: { onboardingComplete: true },
    });
  } catch (error) {
    return actionError(error);
  }
  redirect("/dashboard");
}
