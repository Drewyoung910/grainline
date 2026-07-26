import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deleteR2ObjectByStorageClass } from "@/lib/r2";
import { uploadTelemetryKeyHash } from "@/lib/uploadTelemetry";
import { firstPartyMediaKey } from "@/lib/urlValidation";
import { logServerError } from "@/lib/serverErrorLogger";
import {
  DIRECT_UPLOAD_CLEANUP_BATCH_SIZE,
  DIRECT_UPLOAD_STATUS,
  directUploadErrorMessage,
  directUploadStatusIsClaimable,
} from "@/lib/directUploadLifecycleState";

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

export async function claimDirectUploadForUrl({
  client = prisma,
  url,
  userId,
  claimedByType,
  claimedById = null,
  now = new Date(),
}: {
  client?: DirectUploadClient;
  url: string;
  userId: string;
  claimedByType: string;
  claimedById?: string | null;
  now?: Date;
}) {
  const key = firstPartyMediaKey(url);
  if (!key) return { tracked: false, claimed: false };

  return claimDirectUploadForKey({
    client,
    key,
    userId,
    storageClass: "PUBLIC",
    claimedByType,
    claimedById,
    now,
  });
}

export async function claimDirectUploadForKey({
  client = prisma,
  key,
  userId,
  endpoint,
  storageClass,
  claimedByType,
  claimedById = null,
  now = new Date(),
}: {
  client?: DirectUploadClient;
  key: string;
  userId: string;
  endpoint?: string;
  storageClass: "PUBLIC" | "PRIVATE";
  claimedByType: string;
  claimedById?: string | null;
  now?: Date;
}) {
  const existing = await client.directUpload.findUnique({
    where: { key },
    select: {
      id: true,
      userId: true,
      endpoint: true,
      storageClass: true,
      status: true,
      claimedByType: true,
      claimedById: true,
    },
  });
  if (!existing) return { tracked: false, claimed: false };
  if (
    existing.userId !== userId
    || existing.storageClass !== storageClass
    || (endpoint && existing.endpoint !== endpoint)
  ) {
    throw new DirectUploadClaimError("Attachment upload is not valid for this account.");
  }

  if (existing.status === DIRECT_UPLOAD_STATUS.CLAIMED) {
    if (existing.claimedByType !== claimedByType) {
      throw new DirectUploadClaimError(
        "Attachment upload has already been claimed by another record.",
      );
    }
    if (existing.claimedById) {
      if (existing.claimedById !== claimedById) {
        throw new DirectUploadClaimError(
          "Attachment upload has already been claimed by another record.",
        );
      }
      return { tracked: true, claimed: true };
    }
    if (claimedById) {
      const linked = await client.directUpload.updateMany({
        where: {
          id: existing.id,
          status: DIRECT_UPLOAD_STATUS.CLAIMED,
          claimedByType,
          claimedById: null,
        },
        data: { claimedById },
      });
      if (linked.count !== 1) {
        const current = await client.directUpload.findUnique({
          where: { key },
          select: {
            status: true,
            claimedByType: true,
            claimedById: true,
          },
        });
        if (
          current?.status !== DIRECT_UPLOAD_STATUS.CLAIMED
          || current.claimedByType !== claimedByType
          || current.claimedById !== claimedById
        ) {
          throw new DirectUploadClaimError(
            "Attachment upload has already been claimed by another record.",
          );
        }
      }
    }
    return { tracked: true, claimed: true };
  }

  if (!directUploadStatusIsClaimable(existing.status)) {
    throw new DirectUploadClaimError();
  }

  const claimed = await client.directUpload.updateMany({
    where: {
      id: existing.id,
      status: DIRECT_UPLOAD_STATUS.VERIFIED,
    },
    data: {
      status: DIRECT_UPLOAD_STATUS.CLAIMED,
      claimedAt: now,
      claimedByType,
      claimedById,
      cleanupAfter: null,
      lastError: null,
    },
  });
  if (claimed.count !== 1) {
    throw new DirectUploadClaimError();
  }

  return { tracked: true, claimed: true };
}

export async function claimDirectUploadsForUrls({
  client = prisma,
  urls,
  userId,
  claimedByType,
  claimedById = null,
  now = new Date(),
}: {
  client?: DirectUploadClient;
  urls: readonly string[];
  userId: string;
  claimedByType: string;
  claimedById?: string | null;
  now?: Date;
}) {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  for (const url of uniqueUrls) {
    await claimDirectUploadForUrl({
      client,
      url,
      userId,
      claimedByType,
      claimedById,
      now,
    });
  }
}

export async function processExpiredDirectUploadBatch({
  take = DIRECT_UPLOAD_CLEANUP_BATCH_SIZE,
}: {
  take?: number;
} = {}) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      key: string;
      storageClass: string;
      leaseId: string;
    }>
  >`
    SELECT *
      FROM public.grainline_direct_upload_cleanup_lease(${take})
  `;

  let deleted = 0;
  let skipped = 0;
  const failures: Array<{ id: string; keyHash: string; error: string }> = [];

  for (const row of rows) {
    try {
      await deleteR2ObjectByStorageClass(row.key, row.storageClass);
      const completion = await prisma.$queryRaw<Array<{ completed: boolean }>>`
        SELECT public.grainline_direct_upload_cleanup_complete(
          ${row.id},
          ${row.leaseId}
        ) AS completed
      `;
      if (completion[0]?.completed === true) {
        deleted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      const message = directUploadErrorMessage(error);
      failures.push({
        id: row.id,
        keyHash: uploadTelemetryKeyHash(row.key),
        error: message,
      });
      await prisma.$queryRaw<Array<{ failed: boolean }>>`
        SELECT public.grainline_direct_upload_cleanup_fail(
          ${row.id},
          ${row.leaseId},
          ${message}
        ) AS failed
      `.then((failure) => {
        if (failure[0]?.failed !== true) {
          throw new Error("Direct upload cleanup lease was superseded.");
        }
      }).catch((updateError) => {
        logServerError(updateError, {
          source: "direct_upload_cleanup_mark_failed",
          level: "warning",
          extra: { directUploadId: row.id, keyHash: uploadTelemetryKeyHash(row.key) },
        });
      });
    }
  }

  return {
    checked: rows.length,
    deleted,
    skipped,
    failures,
    complete: rows.length < take,
  };
}
