import { prisma } from "../src/lib/db";

async function clearUploadthingUrls() {
  console.log("Clearing UploadThing URLs from database...");

  // SellerProfile image fields (NOT featuredListingIds — those are IDs not URLs)
  const sellerResult = await prisma.sellerProfile.updateMany({
    where: {
      OR: [
        { bannerImageUrl: { contains: "utfs.io" } },
        { avatarImageUrl: { contains: "utfs.io" } },
        { workshopImageUrl: { contains: "utfs.io" } },
        { galleryImageUrls: { isEmpty: false } },
      ],
    },
    data: {
      bannerImageUrl: null,
      avatarImageUrl: null,
      workshopImageUrl: null,
      galleryImageUrls: [],
    },
  });
  console.log(`Cleared ${sellerResult.count} seller profiles`);

  // Listing photos
  const photoResult = await prisma.photo.deleteMany({
    where: { url: { contains: "utfs.io" } },
  });
  console.log(`Deleted ${photoResult.count} listing photos`);

  // Review photos
  const reviewPhotoResult = await prisma.reviewPhoto.deleteMany({
    where: { url: { contains: "utfs.io" } },
  });
  console.log(`Deleted ${reviewPhotoResult.count} review photos`);

  // Blog post cover images
  const blogResult = await prisma.blogPost.updateMany({
    where: { coverImageUrl: { contains: "utfs.io" } },
    data: { coverImageUrl: null },
  });
  console.log(`Cleared ${blogResult.count} blog post covers`);

  // Commission reference images
  const commissionResult = await prisma.commissionRequest.updateMany({
    where: { referenceImageUrls: { isEmpty: false } },
    data: { referenceImageUrls: [] },
  });
  console.log(`Cleared ${commissionResult.count} commission reference images`);

  console.log("Done.");
  await prisma.$disconnect();
}

clearUploadthingUrls().catch(console.error);
