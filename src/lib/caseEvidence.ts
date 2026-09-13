import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { findOwnedDirectUploadForKey } from "@/lib/directUploadLifecycle";
import { DIRECT_UPLOAD_STATUS } from "@/lib/directUploadLifecycleState";
import { privateR2BucketName, r2 } from "@/lib/r2";
import {
  IMAGE_UPLOAD_TYPES,
  UPLOAD_MAX_SIZES,
} from "@/lib/uploadRules";
import {
  uploadContentTypeMatches,
  uploadFileSignatureMatches,
  uploadKeyBelongsToUser,
} from "@/lib/uploadVerificationToken";

export const CASE_EVIDENCE_UPLOAD_ENDPOINT = "caseEvidenceImage";
export const CASE_EVIDENCE_STORAGE_CLASS = "PRIVATE";
export const MAX_CASE_MESSAGE_ATTACHMENTS = 4;

const PREFIX_BYTE_RANGE = "bytes=0-511";

export function caseEvidenceKeyBelongsToCase({
  key,
  clerkUserId,
  caseId,
}: {
  key: string;
  clerkUserId: string;
  caseId: string;
}) {
  if (
    !uploadKeyBelongsToUser(
      key,
      CASE_EVIDENCE_UPLOAD_ENDPOINT,
      clerkUserId,
    )
  ) {
    return false;
  }
  const parts = key.split("/");
  return parts.length === 4 && parts[2] === caseId && parts[3].length > 0;
}

type VerifiedCaseEvidence =
  | {
      ok: true;
      attachment: {
        directUploadId: string;
        contentType: string;
        byteSize: number;
      };
    }
  | { ok: false; error: string };

async function objectPrefixBytes(key: string) {
  const response = await r2.send(
    new GetObjectCommand({
      Bucket: privateR2BucketName(),
      Key: key,
      Range: PREFIX_BYTE_RANGE,
    }),
  );
  const body = response.Body as
    | { transformToByteArray?: () => Promise<Uint8Array> }
    | undefined;
  if (!body?.transformToByteArray) return new Uint8Array();
  return body.transformToByteArray();
}

export async function verifyPrivateCaseEvidenceForReply({
  key,
  clerkUserId,
  accountUserId,
  caseId,
}: {
  key: string;
  clerkUserId: string;
  accountUserId: string;
  caseId: string;
}): Promise<VerifiedCaseEvidence> {
  if (!caseEvidenceKeyBelongsToCase({ key, clerkUserId, caseId })) {
    return { ok: false, error: "Case evidence upload is not valid for this case." };
  }

  const lifecycle = await findOwnedDirectUploadForKey({
    userId: accountUserId,
    key,
  });
  if (
    !lifecycle
    || lifecycle.endpoint !== CASE_EVIDENCE_UPLOAD_ENDPOINT
    || lifecycle.publicUrl !== null
    || lifecycle.storageClass !== CASE_EVIDENCE_STORAGE_CLASS
    // CLAIMED is accepted here only so an exact HTTP retry can re-verify the
    // private R2 object. The fixed database authority decides whether that
    // claimed upload is the exact replay and rejects every changed-body reuse.
    || (
      lifecycle.status !== DIRECT_UPLOAD_STATUS.VERIFIED
      && lifecycle.status !== DIRECT_UPLOAD_STATUS.CLAIMED
    )
    || !IMAGE_UPLOAD_TYPES.includes(
      lifecycle.contentType as (typeof IMAGE_UPLOAD_TYPES)[number],
    )
  ) {
    return {
      ok: false,
      error: "Case evidence upload expired. Re-upload the image and try again.",
    };
  }

  let head;
  try {
    head = await r2.send(
      new HeadObjectCommand({
        Bucket: privateR2BucketName(),
        Key: key,
      }),
    );
  } catch {
    return {
      ok: false,
      error: "Case evidence upload could not be found. Re-upload the image and try again.",
    };
  }

  const byteSize = head.ContentLength ?? 0;
  if (
    byteSize <= 0
    || byteSize !== lifecycle.expectedSize
    || byteSize > UPLOAD_MAX_SIZES.caseEvidenceImage
    || !uploadContentTypeMatches(head.ContentType, lifecycle.contentType)
  ) {
    return {
      ok: false,
      error: "Case evidence upload could not be verified. Re-upload the image and try again.",
    };
  }

  try {
    const prefixBytes = await objectPrefixBytes(key);
    if (!uploadFileSignatureMatches(prefixBytes, lifecycle.contentType)) {
      return {
        ok: false,
        error: "Case evidence upload could not be verified. Re-upload the image and try again.",
      };
    }
  } catch {
    return {
      ok: false,
      error: "Case evidence upload could not be verified. Re-upload the image and try again.",
    };
  }

  return {
    ok: true,
    attachment: {
      directUploadId: lifecycle.id,
      contentType: lifecycle.contentType,
      byteSize,
    },
  };
}
