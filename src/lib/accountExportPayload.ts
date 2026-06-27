type ExportUser = {
  id: string;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  role: unknown;
  createdAt: Date;
  updatedAt: Date;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  ageAttestedAt: Date | null;
  shippingName: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostalCode: string | null;
  shippingPhone: string | null;
  notificationPreferences: unknown;
};

type AccountExportCollections = {
  accountEmailAddresses: unknown[];
  sellerProfile: unknown;
  listings: unknown[];
  buyerOrders: unknown[];
  sellerOrders: unknown[];
  messagesSent: unknown[];
  messagesReceived: unknown[];
  caseRows: unknown[];
  reviews: unknown[];
  blogPosts: unknown[];
  blogComments: unknown[];
  cart: unknown;
  favorites: unknown[];
  savedSearches: unknown[];
  follows: unknown[];
  savedBlogPosts: unknown[];
  commissionRequests: unknown[];
  commissionInterests: unknown[];
  notifications: unknown[];
  blocks: unknown[];
  userReportsSubmitted: unknown[];
  userReportsReceived: unknown[];
  supportRequests: unknown[];
  emailSuppressions: unknown[];
  emailOutboxRows: unknown[];
  emailFailureCounts: unknown[];
  stockNotifications: unknown[];
  checkoutStockReservations: unknown[];
  makerVerification: unknown;
  sellerFaqs: unknown[];
  newsletterSubscriptions: unknown[];
  sellerBroadcasts: unknown[];
  sellerPayoutEvents: unknown[];
  directUploads: unknown[];
  reviewVotes: unknown[];
};

export function buildAccountExportPayload(
  user: ExportUser,
  data: AccountExportCollections,
  generatedAt = new Date(),
) {
  return {
    generatedAt: generatedAt.toISOString(),
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
    accountEmailAddresses: data.accountEmailAddresses,
    sellerProfile: data.sellerProfile,
    listings: data.listings,
    buyerOrders: data.buyerOrders,
    sellerOrders: data.sellerOrders,
    messagesSent: data.messagesSent,
    messagesReceived: data.messagesReceived,
    cases: data.caseRows,
    reviews: data.reviews,
    blogPosts: data.blogPosts,
    blogComments: data.blogComments,
    cart: data.cart,
    favorites: data.favorites,
    savedSearches: data.savedSearches,
    follows: data.follows,
    savedBlogPosts: data.savedBlogPosts,
    commissionRequests: data.commissionRequests,
    commissionInterests: data.commissionInterests,
    notifications: data.notifications,
    blocks: data.blocks,
    userReportsSubmitted: data.userReportsSubmitted,
    userReportsReceived: data.userReportsReceived,
    supportRequests: data.supportRequests,
    emailSuppressions: data.emailSuppressions,
    emailOutboxRows: data.emailOutboxRows,
    emailFailureCounts: data.emailFailureCounts,
    stockNotifications: data.stockNotifications,
    checkoutStockReservations: data.checkoutStockReservations,
    makerVerification: data.makerVerification,
    sellerFaqs: data.sellerFaqs,
    newsletterSubscriptions: data.newsletterSubscriptions,
    sellerBroadcasts: data.sellerBroadcasts,
    sellerPayoutEvents: data.sellerPayoutEvents,
    directUploads: data.directUploads,
    reviewVotes: data.reviewVotes,
  };
}
