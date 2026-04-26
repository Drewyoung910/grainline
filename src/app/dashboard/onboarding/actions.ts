"use server";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sanitizeRichText, sanitizeText } from "@/lib/sanitize";
import { isR2PublicUrl } from "@/lib/urlValidation";

type ActionResult = { ok: true } | { ok: false; error: string };

function actionError(error: unknown): ActionResult {
  console.error("[onboarding action] error:", error);
  return { ok: false, error: "We couldn't save that step. Please try again." };
}

async function getSeller(): Promise<{ id: string; onboardingStep: number; chargesEnabled: boolean }> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const seller = await prisma.sellerProfile.findFirst({
    where: { user: { clerkId: userId } },
    select: {
      id: true,
      onboardingStep: true,
      chargesEnabled: true,
      user: { select: { banned: true, deletedAt: true } },
    },
  });
  if (!seller) throw new Error("No seller profile");
  if (seller.user.banned || seller.user.deletedAt) throw new Error("Account suspended");
  return { id: seller.id, onboardingStep: seller.onboardingStep, chargesEnabled: seller.chargesEnabled };
}

export async function saveStep1(formData: FormData): Promise<ActionResult> {
  try {
    const seller = await getSeller();
    const displayName = sanitizeText(String(formData.get("displayName") || "").trim().slice(0, 100));
    const bioRaw = String(formData.get("bio") || "").trim().slice(0, 500);
    const bio = bioRaw ? sanitizeRichText(bioRaw) : null;
    const taglineRaw = String(formData.get("tagline") || "").trim().slice(0, 100);
    const tagline = taglineRaw ? sanitizeText(taglineRaw) : null;
    const avatarImageUrl = String(formData.get("avatarImageUrl") || "").trim() || null;
    if (avatarImageUrl && !isR2PublicUrl(avatarImageUrl)) {
      return { ok: false, error: "Use an uploaded Grainline image for your profile photo." };
    }

    await prisma.sellerProfile.update({
      where: { id: seller.id },
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
    const seller = await getSeller();
    const yearsRaw = formData.get("yearsInBusiness");
    const yearsNum = yearsRaw ? parseInt(String(yearsRaw), 10) : NaN;
    const yearsInBusiness = !Number.isNaN(yearsNum) ? Math.max(0, Math.min(100, yearsNum)) : null;
    const city = String(formData.get("city") || "").trim().slice(0, 100) || null;
    const state = String(formData.get("state") || "").trim().slice(0, 100) || null;
    const returnPolicyRaw = String(formData.get("returnPolicy") || "").trim().slice(0, 2000);
    const shippingPolicyRaw = String(formData.get("shippingPolicy") || "").trim().slice(0, 2000);
    const returnPolicy = returnPolicyRaw ? sanitizeRichText(returnPolicyRaw) : null;
    const shippingPolicy = shippingPolicyRaw ? sanitizeRichText(shippingPolicyRaw) : null;
    const acceptsCustomOrders = formData.get("acceptsCustomOrders") === "on";

    await prisma.sellerProfile.update({
      where: { id: seller.id },
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
    const seller = await getSeller();
    const normalizedStep = Math.max(0, Math.min(5, Math.floor(targetStep)));
    if (normalizedStep > seller.onboardingStep + 1) {
      return { ok: false, error: "Complete the current onboarding step first." };
    }
    await prisma.sellerProfile.update({
      where: { id: seller.id },
      data: { onboardingStep: normalizedStep },
    });
    revalidatePath("/dashboard/onboarding");
    return { ok: true };
  } catch (error) {
    return actionError(error);
  }
}

export async function completeOnboarding(): Promise<ActionResult> {
  try {
    const seller = await getSeller();
    if (seller.onboardingStep < 5) {
      return { ok: false, error: "Finish onboarding before opening your dashboard." };
    }
    if (!seller.chargesEnabled) {
      return { ok: false, error: "Connect Stripe before completing onboarding." };
    }
    await prisma.sellerProfile.update({
      where: { id: seller.id },
      data: { onboardingComplete: true },
    });
  } catch (error) {
    return actionError(error);
  }
  redirect("/dashboard");
}
