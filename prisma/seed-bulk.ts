// prisma/seed-bulk.ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function assertNonProductionSeed() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    throw new Error("Refusing to run seed in production.");
  }
  if (process.env.ALLOW_BULK_SEED !== "true") {
    throw new Error("Refusing to run bulk seed without ALLOW_BULK_SEED=true.");
  }
}

async function main() {
  assertNonProductionSeed();

  // Create a dummy user/seller (not tied to Clerk)
  const user = await prisma.user.upsert({
    where: { clerkId: "seed_clerk_user" },
    update: {},
    create: {
      clerkId: "seed_clerk_user",
      email: "seed@example.com",
      name: "Seed Seller",
      imageUrl: null,
    },
  });

  const seller = await prisma.sellerProfile.upsert({
    where: { userId: user.id },
    update: { displayName: "Seed Seller" },
    create: { userId: user.id, displayName: "Seed Seller" },
  });

  const imgs = [
    "https://images.unsplash.com/photo-1519710164239-da123dc03ef4",
    "https://images.unsplash.com/photo-1555041469-a586c61ea9bc",
    "https://images.unsplash.com/photo-1519710884000-9f3a9d0d0f3f",
    "https://images.unsplash.com/photo-1503602642458-232111445657",
  ];

  // make ~40 items
  const toCreate = Array.from({ length: 40 }).map((_, i) => ({
    sellerId: seller.id,
    title: `Sample Listing #${i + 1}`,
    description:
      "Sample description for testing pagination. Handmade vibes, very artisanal.",
    priceCents: 1500 + Math.floor(Math.random() * 50000),
    photos: {
      create: [{ url: imgs[i % imgs.length], sortOrder: 0 }],
    },
  }));

  // Insert in chunks to keep it tidy
  while (toCreate.length) {
    const chunk = toCreate.splice(0, 10);
    await prisma.listing.createMany({
      data: chunk.map(({ sellerId, title, description, priceCents }) => ({
        sellerId,
        title,
        description,
        priceCents,
      })),
    });

    // attach photos (createMany can’t do nested)
    const fresh = await prisma.listing.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: "desc" },
      take: chunk.length,
      select: { id: true },
    });

    await Promise.all(
      fresh.map((l, idx) =>
        prisma.photo.create({
          data: {
            listingId: l.id,
            url: imgs[idx % imgs.length],
            sortOrder: 0,
          },
        })
      )
    );
  }

  console.log("Seeded ~40 listings for pagination ✅");
}

main().finally(() => prisma.$disconnect());
