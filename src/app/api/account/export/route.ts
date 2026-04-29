import { NextResponse } from "next/server";
import { ensureUser, isAccountAccessError } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { accountExportRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { accountExportJsonResponse } from "@/lib/accountExportFormat";

export const runtime = "nodejs";

type ExportableUser = Awaited<ReturnType<typeof ensureUser>>;

function jsonDownload(data: unknown, userId: string) {
  return accountExportJsonResponse(data, userId);
}

async function buildExport(user: NonNullable<ExportableUser>) {
  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      displayName: true,
      bio: true,
      city: true,
      state: true,
      lat: true,
      lng: true,
      radiusMeters: true,
      publicMapOptIn: true,
      chargesEnabled: true,
      shippingFlatRateCents: true,
      freeShippingOverCents: true,
      allowLocalPickup: true,
      useCalculatedShipping: true,
      preferredCarriers: true,
      tagline: true,
      bannerImageUrl: true,
      avatarImageUrl: true,
      workshopImageUrl: true,
      vacationMode: true,
      vacationMessage: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const [
    listings,
    buyerOrders,
    sellerOrders,
    messagesSent,
    messagesReceived,
    caseRows,
    reviews,
    blogPosts,
    blogComments,
    cart,
    favorites,
    savedSearches,
    follows,
    savedBlogPosts,
    commissionRequests,
    commissionInterests,
    notifications,
  ] = await Promise.all([
    sellerProfile
      ? prisma.listing.findMany({
          where: { sellerId: sellerProfile.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            title: true,
            description: true,
            priceCents: true,
            currency: true,
            status: true,
            isPrivate: true,
            listingType: true,
            stockQuantity: true,
            category: true,
            tags: true,
            createdAt: true,
            updatedAt: true,
            photos: { orderBy: { sortOrder: "asc" }, select: { url: true, altText: true, sortOrder: true } },
            variantGroups: {
              orderBy: { sortOrder: "asc" },
              select: {
                name: true,
                sortOrder: true,
                options: { orderBy: { sortOrder: "asc" }, select: { label: true, priceAdjustCents: true, sortOrder: true, inStock: true } },
              },
            },
          },
        })
      : [],
    prisma.order.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        paidAt: true,
        currency: true,
        itemsSubtotalCents: true,
        shippingTitle: true,
        shippingAmountCents: true,
        taxAmountCents: true,
        buyerEmail: true,
        buyerName: true,
        shipToLine1: true,
        shipToLine2: true,
        shipToCity: true,
        shipToState: true,
        shipToPostalCode: true,
        shipToCountry: true,
        fulfillmentMethod: true,
        fulfillmentStatus: true,
        trackingCarrier: true,
        trackingNumber: true,
        shippedAt: true,
        deliveredAt: true,
        sellerRefundId: true,
        sellerRefundAmountCents: true,
        giftNote: true,
        giftWrapping: true,
        giftWrappingPriceCents: true,
        buyerDataPurgedAt: true,
        items: {
          select: {
            listingId: true,
            quantity: true,
            priceCents: true,
            selectedVariants: true,
            listingSnapshot: true,
            listing: { select: { title: true, sellerId: true } },
          },
        },
        paymentEvents: {
          orderBy: { createdAt: "desc" },
          select: {
            eventType: true,
            amountCents: true,
            currency: true,
            status: true,
            reason: true,
            description: true,
            createdAt: true,
          },
        },
      },
    }),
    sellerProfile
      ? prisma.order.findMany({
          where: { items: { some: { listing: { sellerId: sellerProfile.id } } } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            createdAt: true,
            paidAt: true,
            currency: true,
            itemsSubtotalCents: true,
            shippingTitle: true,
            shippingAmountCents: true,
            taxAmountCents: true,
            fulfillmentMethod: true,
            fulfillmentStatus: true,
            trackingCarrier: true,
            trackingNumber: true,
            shippedAt: true,
            deliveredAt: true,
            sellerRefundId: true,
            sellerRefundAmountCents: true,
            items: {
              where: { listing: { sellerId: sellerProfile.id } },
              select: {
                listingId: true,
                quantity: true,
                priceCents: true,
                selectedVariants: true,
                listingSnapshot: true,
                listing: { select: { title: true } },
              },
            },
            paymentEvents: {
              orderBy: { createdAt: "desc" },
              select: {
                eventType: true,
                amountCents: true,
                currency: true,
                status: true,
                reason: true,
                description: true,
                createdAt: true,
              },
            },
          },
        })
      : [],
    prisma.message.findMany({
      where: { senderId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, conversationId: true, recipientId: true, body: true, kind: true, isSystemMessage: true, readAt: true, createdAt: true },
    }),
    prisma.message.findMany({
      where: { recipientId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, conversationId: true, senderId: true, body: true, kind: true, isSystemMessage: true, readAt: true, createdAt: true },
    }),
    prisma.case.findMany({
      where: { OR: [{ buyerId: user.id }, { sellerId: user.id }] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        orderId: true,
        buyerId: true,
        sellerId: true,
        reason: true,
        description: true,
        status: true,
        resolution: true,
        refundAmountCents: true,
        sellerRespondBy: true,
        resolvedAt: true,
        createdAt: true,
        updatedAt: true,
        messages: { orderBy: { createdAt: "asc" }, select: { id: true, authorId: true, body: true, createdAt: true } },
      },
    }),
    prisma.review.findMany({
      where: { reviewerId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        listingId: true,
        ratingX2: true,
        comment: true,
        verified: true,
        helpfulCount: true,
        sellerReply: true,
        sellerReplyAt: true,
        createdAt: true,
        updatedAt: true,
        photos: { orderBy: { sortOrder: "asc" }, select: { url: true, altText: true, sortOrder: true } },
        listing: { select: { title: true } },
      },
    }),
    prisma.blogPost.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        body: true,
        coverImageUrl: true,
        videoUrl: true,
        authorType: true,
        type: true,
        status: true,
        featuredListingIds: true,
        tags: true,
        metaDescription: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.blogComment.findMany({
      where: { authorId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, postId: true, body: true, approved: true, parentId: true, createdAt: true },
    }),
    prisma.cart.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        items: {
          select: {
            listingId: true,
            quantity: true,
            priceCents: true,
            selectedVariantOptionIds: true,
            variantKey: true,
            createdAt: true,
            listing: { select: { title: true } },
          },
        },
      },
    }),
    prisma.favorite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { listingId: true, createdAt: true, listing: { select: { title: true, status: true } } },
    }),
    prisma.savedSearch.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.follow.findMany({
      where: { followerId: user.id },
      orderBy: { createdAt: "desc" },
      select: { sellerProfileId: true, createdAt: true, sellerProfile: { select: { displayName: true } } },
    }),
    prisma.savedBlogPost.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { blogPostId: true, createdAt: true, blogPost: { select: { title: true, slug: true } } },
    }),
    prisma.commissionRequest.findMany({
      where: { buyerId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        budgetMinCents: true,
        budgetMaxCents: true,
        timeline: true,
        referenceImageUrls: true,
        status: true,
        interestedCount: true,
        expiresAt: true,
        isNational: true,
        lat: true,
        lng: true,
        radiusMeters: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    sellerProfile
      ? prisma.commissionInterest.findMany({
          where: { sellerProfileId: sellerProfile.id },
          orderBy: { createdAt: "desc" },
          select: { commissionRequestId: true, conversationId: true, createdAt: true },
        })
      : [],
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, title: true, body: true, link: true, read: true, createdAt: true },
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    account: {
      id: user.id,
      email: user.email,
      name: user.name,
      imageUrl: user.imageUrl,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      termsAcceptedAt: user.termsAcceptedAt,
      termsVersion: user.termsVersion,
      ageAttestedAt: user.ageAttestedAt,
      shippingName: user.shippingName,
      shippingLine1: user.shippingLine1,
      shippingLine2: user.shippingLine2,
      shippingCity: user.shippingCity,
      shippingState: user.shippingState,
      shippingPostalCode: user.shippingPostalCode,
      shippingPhone: user.shippingPhone,
      notificationPreferences: user.notificationPreferences,
    },
    sellerProfile,
    listings,
    buyerOrders,
    sellerOrders,
    messagesSent,
    messagesReceived,
    cases: caseRows,
    reviews,
    blogPosts,
    blogComments,
    cart,
    favorites,
    savedSearches,
    follows,
    savedBlogPosts,
    commissionRequests,
    commissionInterests,
    notifications,
  };
}

async function handleExport() {
  try {
    const user = await ensureUser();
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const rate = await safeRateLimit(accountExportRatelimit, user.id);
    if (!rate.success) return rateLimitResponse(rate.reset, "Too many account export requests.");

    return jsonDownload(await buildExport(user), user.id);
  } catch (error) {
    if (isAccountAccessError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("account export failed", error);
    return NextResponse.json({ error: "Could not generate account export" }, { status: 500 });
  }
}

export async function GET() {
  return handleExport();
}

export async function POST() {
  return handleExport();
}
