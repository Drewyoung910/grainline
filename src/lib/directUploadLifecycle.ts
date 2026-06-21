import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deleteR2ObjectByKey } from "@/lib/r2";
import { uploadTelemetryKeyHash } from "@/lib/uploadTelemetry";
import { firstPartyMediaKey } from "@/lib/urlValidation";
import { logServerError } from "@/lib/serverErrorLogger";
import {
  DIRECT_UPLOAD_CLEANUP_BATCH_SIZE,
  DIRECT_UPLOAD_CLEANUP_STATUSES,
  DIRECT_UPLOAD_STATUS,
  directUploadErrorMessage,
  directUploadPresignedCleanupAfter,
  directUploadRetryCleanupAfter,
  directUploadStatusIsClaimable,
  directUploadVerifiedCleanupAfter,
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
  now = new Date(),
}: {
  key: string;
  endpoint: string;
  userId: string;
  publicUrl: string;
  contentType: string;
  expectedSize: number;
  now?: Date;
}) {
  await prisma.directUpload.create({
    data: {
      key,
      endpoint,
      userId,
      publicUrl,
      contentType,
      expectedSize,
      status: DIRECT_UPLOAD_STATUS.PRESIGNED,
      cleanupAfter: directUploadPresignedCleanupAfter(now),
    },
  });
}

export async function recordDirectUploadVerified({
  key,
  endpoint,
  userId,
  publicUrl,
  contentType,
  expectedSize,
  now = new Date(),
}: {
  key: string;
  endpoint: string;
  userId: string;
  publicUrl: string;
  contentType: string;
  expectedSize: number;
  now?: Date;
}) {
  await prisma.directUpload.create({
    data: {
      key,
      endpoint,
      userId,
      publicUrl,
      contentType,
      expectedSize,
      status: DIRECT_UPLOAD_STATUS.VERIFIED,
      verifiedAt: now,
      cleanupAfter: directUploadVerifiedCleanupAfter(now),
    },
  });
}

export async function markDirectUploadVerified({
  key,
  endpoint,
  userId,
  now = new Date(),
}: {
  key: string;
  endpoint: string;
  userId: string;
  now?: Date;
}) {
  const updated = await prisma.directUpload.updateMany({
    where: {
      key,
      endpoint,
      userId,
      status: { in: [DIRECT_UPLOAD_STATUS.PRESIGNED, DIRECT_UPLOAD_STATUS.VERIFIED] },
    },
    data: {
      status: DIRECT_UPLOAD_STATUS.VERIFIED,
      verifiedAt: now,
      cleanupAfter: directUploadVerifiedCleanupAfter(now),
      lastError: null,
    },
  });
  return updated.count === 1;
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

  const existing = await client.directUpload.findUnique({
    where: { key },
    select: {
      id: true,
      userId: true,
      status: true,
      claimedById: true,
    },
  });
  if (!existing) return { tracked: false, claimed: false };
  if (existing.userId !== userId) {
    throw new DirectUploadClaimError("Attachment upload is not valid for this account.");
  }

  if (existing.status === DIRECT_UPLOAD_STATUS.CLAIMED) {
    if (claimedById && !existing.claimedById) {
      await client.directUpload.updateMany({
        where: { id: existing.id, status: DIRECT_UPLOAD_STATUS.CLAIMED, claimedById: null },
        data: { claimedById },
      });
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
  now = new Date(),
}: {
  take?: number;
  now?: Date;
} = {}) {
  const rows = await prisma.directUpload.findMany({
    where: {
      status: { in: [...DIRECT_UPLOAD_CLEANUP_STATUSES] },
      cleanupAfter: { lte: now },
    },
    orderBy: [{ cleanupAfter: "asc" }, { id: "asc" }],
    take,
    select: {
      id: true,
      key: true,
      status: true,
      attempts: true,
      cleanupAfter: true,
    },
  });

  let deleted = 0;
  let skipped = 0;
  const failures: Array<{ id: string; keyHash: string; error: string }> = [];

  for (const row of rows) {
    const deleting = await prisma.directUpload.updateMany({
      where: {
        id: row.id,
        status: { in: [...DIRECT_UPLOAD_CLEANUP_STATUSES] },
        cleanupAfter: { lte: now },
      },
      data: {
        status: DIRECT_UPLOAD_STATUS.DELETING,
        attempts: { increment: 1 },
        cleanupAfter: directUploadRetryCleanupAfter(now),
        lastError: null,
      },
    });
    if (deleting.count !== 1) {
      skipped += 1;
      continue;
    }

    try {
      await deleteR2ObjectByKey(row.key);
      await prisma.directUpload.update({
        where: { id: row.id },
        data: {
          status: DIRECT_UPLOAD_STATUS.DELETED,
          deletedAt: new Date(),
          cleanupAfter: null,
          lastError: null,
        },
      });
      deleted += 1;
    } catch (error) {
      const message = directUploadErrorMessage(error);
      failures.push({
        id: row.id,
        keyHash: uploadTelemetryKeyHash(row.key),
        error: message,
      });
      await prisma.directUpload.update({
        where: { id: row.id },
        data: {
          status: DIRECT_UPLOAD_STATUS.DELETE_FAILED,
          cleanupAfter: directUploadRetryCleanupAfter(now),
          lastError: message,
        },
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
