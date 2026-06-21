import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "@/lib/r2";
import {
  IMAGE_UPLOAD_TYPES,
  UPLOAD_ENDPOINTS,
  UPLOAD_MAX_SIZES,
  type UploadEndpoint,
} from "@/lib/uploadRules";
import { firstPartyMediaKey } from "@/lib/urlValidation";
import {
  uploadContentTypeMatches,
  uploadFileSignatureMatches,
  uploadKeyBelongsToUser,
} from "@/lib/uploadVerificationToken";
import { DIRECT_UPLOAD_STATUS } from "@/lib/directUploadLifecycleState";
import { prisma } from "@/lib/db";

const PREFIX_BYTE_RANGE = "bytes=0-511";

export const MESSAGE_ATTACHMENT_CONTENT_TYPES = [
  ...IMAGE_UPLOAD_TYPES,
  "application/pdf",
] as const;

type UploadPersistenceVerificationResult =
  | { ok: true }
  | { ok: false; error: string };

async function objectPrefixBytes(key: string) {
  const response = await r2.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
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

function matchingContentType(
  actualContentType: string | null | undefined,
  allowedContentTypes: readonly string[],
) {
  return allowedContentTypes.find((expected) =>
    uploadContentTypeMatches(actualContentType, expected),
  ) ?? null;
}

function uploadEndpointFromKey(key: string): UploadEndpoint | null {
  const endpoint = key.split("/")[0];
  if (UPLOAD_ENDPOINTS.includes(endpoint as UploadEndpoint)) {
    return endpoint as UploadEndpoint;
  }
  return null;
}

export async function verifyFirstPartyUploadForPersistence({
  url,
  endpoint,
  clerkUserId,
  accountUserId,
  allowedContentTypes,
}: {
  url: string;
  endpoint: UploadEndpoint;
  clerkUserId: string;
  accountUserId?: string;
  allowedContentTypes: readonly string[];
}): Promise<UploadPersistenceVerificationResult> {
  const key = firstPartyMediaKey(url);
  if (!key || !uploadKeyBelongsToUser(key, endpoint, clerkUserId)) {
    return { ok: false, error: "Attachment upload is not valid for this account." };
  }

  let head;
  try {
    head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch {
    return { ok: false, error: "Attachment upload could not be found. Re-upload the file and try again." };
  }

  const matchedContentType = matchingContentType(
    head.ContentType,
    allowedContentTypes,
  );
  const size = head.ContentLength ?? 0;
  if (!matchedContentType || size <= 0 || size > UPLOAD_MAX_SIZES[endpoint]) {
    return { ok: false, error: "Attachment upload could not be verified. Re-upload the file and try again." };
  }

  let prefixBytes: Uint8Array;
  try {
    prefixBytes = await objectPrefixBytes(key);
  } catch {
    return { ok: false, error: "Attachment upload could not be verified. Re-upload the file and try again." };
  }

  if (!uploadFileSignatureMatches(prefixBytes, matchedContentType)) {
    return { ok: false, error: "Attachment upload could not be verified. Re-upload the file and try again." };
  }

  const lifecycle = await prisma.directUpload.findUnique({
    where: { key },
    select: {
      userId: true,
      status: true,
      expectedSize: true,
      contentType: true,
    },
  });
  if (lifecycle) {
    const lifecycleStatusCanPersist =
      lifecycle.status === DIRECT_UPLOAD_STATUS.VERIFIED ||
      lifecycle.status === DIRECT_UPLOAD_STATUS.CLAIMED;
    const trackedUploadMatches =
      (!accountUserId || lifecycle.userId === accountUserId) &&
      lifecycle.expectedSize === size &&
      uploadContentTypeMatches(head.ContentType, lifecycle.contentType);
    if (!trackedUploadMatches || !lifecycleStatusCanPersist) {
      return { ok: false, error: "Attachment upload could not be verified. Re-upload the file and try again." };
    }
  }

  return { ok: true };
}

export async function verifyFirstPartyMediaUrlForPersistence({
  url,
  allowedEndpoints,
  clerkUserId,
  accountUserId,
  allowedContentTypes,
}: {
  url: string;
  allowedEndpoints: readonly UploadEndpoint[];
  clerkUserId: string;
  accountUserId?: string;
  allowedContentTypes: readonly string[];
}): Promise<UploadPersistenceVerificationResult> {
  const key = firstPartyMediaKey(url);
  if (!key) {
    return { ok: false, error: "Upload is not valid for this account." };
  }
  const endpoint = uploadEndpointFromKey(key);
  if (!endpoint || !allowedEndpoints.includes(endpoint)) {
    return { ok: false, error: "Upload is not valid for this account." };
  }
  return verifyFirstPartyUploadForPersistence({
    url,
    endpoint,
    clerkUserId,
    accountUserId,
    allowedContentTypes,
  });
}

export async function filterVerifiedFirstPartyMediaUrlsForUser({
  urls,
  max,
  clerkUserId,
  accountUserId,
  allowedEndpoints,
  allowedContentTypes = IMAGE_UPLOAD_TYPES,
  existingUrls = [],
}: {
  urls: string[];
  max: number;
  clerkUserId: string;
  accountUserId?: string;
  allowedEndpoints: readonly UploadEndpoint[];
  allowedContentTypes?: readonly string[];
  existingUrls?: readonly (string | null | undefined)[];
}): Promise<string[]> {
  const existingUrlSet = new Set(existingUrls.filter((url): url is string => Boolean(url)));
  const verified: string[] = [];

  for (const url of urls) {
    if (verified.length >= max) break;
    if (existingUrlSet.has(url)) {
      verified.push(url);
      continue;
    }
    const result = await verifyFirstPartyMediaUrlForPersistence({
      url,
      allowedEndpoints,
      clerkUserId,
      accountUserId,
      allowedContentTypes,
    });
    if (result.ok) {
      verified.push(url);
    }
  }

  return verified;
}
