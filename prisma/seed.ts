import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Ensure you (User) exist – visit /dashboard once before seeding
  const me = await prisma.user.findFirst();
  if (!me) throw new Error("No user yet. Visit /dashboard once while signed in, then re-run.");

  // Ensure a SellerProfile for you (Listing.sellerId -> SellerProfile.id)
  const seller = await prisma.sellerProfile.upsert({
    where: { userId: me.id },
    update: {},
    create: {
      userId: me.id,
      displayName: me.name ?? me.email.split("@")[0],
      bio: "Woodworker",
      city: "Austin",
      state: "TX",
    },
  });

  // wipe demo data
  await prisma.photo.deleteMany();
  await prisma.listing.deleteMany();

  // Create listings (NO `category`, images go in Photo)
  const l1 = await prisma.listing.create({
    data: {
      sellerId: seller.id,
      title: "Walnut Bench",
      description: "Handmade solid walnut entry bench.",
      priceCents: 32000,
      photos: {
        create: [
          {
            url: "https://images.unsplash.com/photo-1519710164239-da123dc03ef4",
            sortOrder: 0,
          },
        ],
      },
    },
  });

  const l2 = await prisma.listing.create({
    data: {
      sellerId: seller.id,
      title: "Maple Cutting Board",
      description: "End-grain maple board with juice groove.",
      priceCents: 7500,
      photos: {
        create: [
          {
            url: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc",
            sortOrder: 0,
          },
        ],
      },
    },
  });

  console.log("Seeded listings ✅", { l1: l1.id, l2: l2.id });
}

main().finally(() => prisma.$disconnect());

