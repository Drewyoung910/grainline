import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type DirectUploadClient = Prisma.TransactionClient | typeof prisma;

export class DirectUploadClaimError extends Error {
  constructor(message = "Attachment upload expired. Re-upload the file and try again.") {
    super(message);
    this.name = "DirectUploadClaimError";
  }
}

export async function recordDirectUploadPresigned({
  key,
  endpoint,
  userId,
  publicUrl,
  contentType,
  expectedSize,
}: {
  key: string;
  endpoint: string;
  userId: string;
  publicUrl: string;
  contentType: string;
  expectedSize: number;
}) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT public.grainline_direct_upload_record_presigned_public(
      ${userId},
      ${key},
      ${endpoint},
      ${publicUrl},
      ${contentType},
      ${expectedSize}
    ) AS id
  `;
  if (!rows[0]?.id) throw new Error("Direct upload lifecycle was not recorded.");
  return rows[0].id;
}

export async function recordDirectUploadVerified({
  key,
  endpoint,
  userId,
  publicUrl,
  contentType,
  expectedSize,
  storageClass = "PUBLIC",
  contextId,
}: {
  key: string;
  endpoint: string;
  userId: string;
  publicUrl: string | null;
  contentType: string;
  expectedSize: number;
  storageClass?: "PUBLIC" | "PRIVATE";
  contextId?: string;
}) {
  if (storageClass === "PRIVATE") {
    if (endpoint !== "caseEvidenceImage" || !contextId || publicUrl !== null) {
      throw new Error("Private direct upload lifecycle context is invalid.");
    }
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT public.grainline_direct_upload_record_private_case(
        ${userId},
        ${contextId},
        ${key},
        ${contentType},
        ${expectedSize}
      ) AS id
    `;
    if (!rows[0]?.id) throw new Error("Direct upload lifecycle was not recorded.");
    return rows[0].id;
  }

  if (!publicUrl) {
    throw new Error("Public direct upload lifecycle URL is required.");
  }
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT public.grainline_direct_upload_record_processed_public(
      ${userId},
      ${key},
      ${endpoint},
      ${publicUrl},
      ${contentType},
      ${expectedSize}
    ) AS id
  `;
  if (!rows[0]?.id) throw new Error("Direct upload lifecycle was not recorded.");
  return rows[0].id;
}

export async function markDirectUploadVerified({
  key,
  endpoint,
  userId,
}: {
  key: string;
  endpoint: string;
  userId: string;
}) {
  const rows = await prisma.$queryRaw<Array<{ verified: boolean }>>`
    SELECT public.grainline_direct_upload_verify_public(
      ${userId},
      ${key},
      ${endpoint}
    ) AS verified
  `;
  return rows[0]?.verified === true;
}

export type OwnedDirectUploadLifecycle = {
  id: string;
  endpoint: string;
  publicUrl: string | null;
  storageClass: string;
  contentType: string;
  expectedSize: number;
  status: string;
};

export async function findOwnedDirectUploadForKey({
  client = prisma,
  userId,
  key,
}: {
  client?: DirectUploadClient;
  userId: string;
  key: string;
}) {
  const rows = await client.$queryRaw<OwnedDirectUploadLifecycle[]>`
    SELECT *
      FROM public.grainline_direct_upload_owned_lookup(
        ${userId},
        ${key}
      )
  `;
  return rows[0] ?? null;
}

export async function referenceDirectUploadCaseAttachment({
  client = prisma,
  userId,
  attachmentId,
}: {
  client?: DirectUploadClient;
  userId: string;
  attachmentId: string;
}) {
  const rows = await client.$queryRaw<Array<{ referenced: boolean }>>`
    SELECT public.grainline_direct_upload_reference_case_attachment(
      ${userId},
      ${attachmentId}
    ) AS referenced
  `;
  return rows[0]?.referenced === true;
}

export async function readDirectUploadCaseAttachment({
  userId,
  caseId,
  attachmentId,
}: {
  userId: string;
  caseId: string;
  attachmentId: string;
}) {
  const rows = await prisma.$queryRaw<
    Array<{ key: string; contentType: string }>
  >`
    SELECT *
      FROM public.grainline_direct_upload_case_attachment_read(
        ${userId},
        ${caseId},
        ${attachmentId}
      )
  `;
  return rows[0] ?? null;
}

export type DirectUploadExportRow = {
  id: string;
  endpoint: string;
  storageClass: string;
  contentType: string;
  expectedSize: number;
  status: string;
  cleanupAfter: Date | null;
  verifiedAt: Date | null;
  claimedAt: Date | null;
  deletedAt: Date | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
};

export async function exportOwnedDirectUploads(userId: string) {
  return prisma.$queryRaw<DirectUploadExportRow[]>`
    SELECT *
      FROM public.grainline_direct_upload_export(${userId})
  `;
}

export async function accountDirectUploadPublicUrls({
  client,
  userId,
}: {
  client: Pick<Prisma.TransactionClient, "$queryRaw">;
  userId: string;
}) {
  return client.$queryRaw<Array<{ publicUrl: string }>>`
    SELECT *
      FROM public.grainline_direct_upload_account_public_urls(${userId})
  `;
}

export async function releaseDirectUploadsForAccount({
  client,
  userId,
}: {
  client: Pick<Prisma.TransactionClient, "$queryRaw">;
  userId: string;
}) {
  const rows = await client.$queryRaw<Array<{ released: number }>>`
    SELECT public.grainline_direct_upload_release_for_account(
      ${userId}
    ) AS released
  `;
  return rows[0]?.released ?? 0;
}

export type DirectUploadReferenceSyncResult = {
  referenced: number;
  released: number;
  untracked: number;
};

function checkedReferenceSync(
  rows: DirectUploadReferenceSyncResult[],
  requireAllTracked: boolean,
) {
  const result = rows[0];
  if (!result) {
    throw new DirectUploadClaimError("Upload references could not be synchronized.");
  }
  if (requireAllTracked && result.untracked > 0) {
    throw new DirectUploadClaimError(
      "An upload is missing lifecycle verification. Re-upload it and try again.",
    );
  }
  return result;
}

export async function syncListingDirectUploadReferences({
  client = prisma,
  userId,
  listingId,
  requireAllTracked = false,
}: {
  client?: DirectUploadClient;
  userId: string;
  listingId: string;
  requireAllTracked?: boolean;
}) {
  const rows = await client.$queryRaw<DirectUploadReferenceSyncResult[]>`
    SELECT *
      FROM public.grainline_direct_upload_sync_listing(
        ${userId},
        ${listingId}
      )
  `;
  return checkedReferenceSync(rows, requireAllTracked);
}

export async function syncSellerProfileDirectUploadReferences({
  client = prisma,
  userId,
  sellerProfileId,
  requireAllTracked = false,
}: {
  client?: DirectUploadClient;
  userId: string;
  sellerProfileId: string;
  requireAllTracked?: boolean;
}) {
  const rows = await client.$queryRaw<DirectUploadReferenceSyncResult[]>`
    SELECT *
      FROM public.grainline_direct_upload_sync_seller_profile(
        ${userId},
        ${sellerProfileId}
      )
  `;
  return checkedReferenceSync(rows, requireAllTracked);
}

export async function syncReviewDirectUploadReferences({
  client = prisma,
  userId,
  reviewId,
  requireAllTracked = false,
}: {
  client?: DirectUploadClient;
  userId: string;
  reviewId: string;
  requireAllTracked?: boolean;
}) {
  const rows = await client.$queryRaw<DirectUploadReferenceSyncResult[]>`
    SELECT *
      FROM public.grainline_direct_upload_sync_review(
        ${userId},
        ${reviewId}
      )
  `;
  return checkedReferenceSync(rows, requireAllTracked);
}

export async function syncBlogPostDirectUploadReferences({
  client = prisma,
  userId,
  blogPostId,
  requireAllTracked = false,
}: {
  client?: DirectUploadClient;
  userId: string;
  blogPostId: string;
  requireAllTracked?: boolean;
}) {
  const rows = await client.$queryRaw<DirectUploadReferenceSyncResult[]>`
    SELECT *
      FROM public.grainline_direct_upload_sync_blog_post(
        ${userId},
        ${blogPostId}
      )
  `;
  return checkedReferenceSync(rows, requireAllTracked);
}

export async function syncCommissionRequestDirectUploadReferences({
  client = prisma,
  userId,
  commissionRequestId,
  requireAllTracked = false,
}: {
  client?: DirectUploadClient;
  userId: string;
  commissionRequestId: string;
  requireAllTracked?: boolean;
}) {
  const rows = await client.$queryRaw<DirectUploadReferenceSyncResult[]>`
    SELECT *
      FROM public.grainline_direct_upload_sync_commission_request(
        ${userId},
        ${commissionRequestId}
      )
  `;
  return checkedReferenceSync(rows, requireAllTracked);
}

export async function syncSellerBroadcastDirectUploadReferences({
  client = prisma,
  userId,
  sellerBroadcastId,
  requireAllTracked = false,
}: {
  client?: DirectUploadClient;
  userId: string;
  sellerBroadcastId: string;
  requireAllTracked?: boolean;
}) {
  const rows = await client.$queryRaw<DirectUploadReferenceSyncResult[]>`
    SELECT *
      FROM public.grainline_direct_upload_sync_seller_broadcast(
        ${userId},
        ${sellerBroadcastId}
      )
  `;
  return checkedReferenceSync(rows, requireAllTracked);
}

export async function syncLegacyMessageDirectUploadReference({
  client = prisma,
  userId,
  messageId,
  requireAllTracked = false,
}: {
  client?: DirectUploadClient;
  userId: string;
  messageId: string;
  requireAllTracked?: boolean;
}) {
  const rows = await client.$queryRaw<DirectUploadReferenceSyncResult[]>`
    SELECT *
      FROM public.grainline_direct_upload_sync_legacy_message(
        ${userId},
        ${messageId}
      )
  `;
  return checkedReferenceSync(rows, requireAllTracked);
}
