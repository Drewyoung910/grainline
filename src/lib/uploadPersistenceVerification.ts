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
import { findOwnedDirectUploadForKey } from "@/lib/directUploadLifecycle";

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
  accountUserId: string;
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

  const lifecycle = await findOwnedDirectUploadForKey({
    userId: accountUserId,
    key,
  });
  const lifecycleStatusCanPersist =
    lifecycle?.status === DIRECT_UPLOAD_STATUS.VERIFIED ||
    lifecycle?.status === DIRECT_UPLOAD_STATUS.CLAIMED;
  const trackedUploadMatches =
    lifecycle?.endpoint === endpoint &&
    lifecycle.storageClass === "PUBLIC" &&
    lifecycle.expectedSize === size &&
    uploadContentTypeMatches(head.ContentType, lifecycle.contentType);
  if (!trackedUploadMatches || !lifecycleStatusCanPersist) {
    return { ok: false, error: "Attachment upload could not be verified. Re-upload the file and try again." };
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
  accountUserId: string;
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
  accountUserId: string;
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

export type VerifiedFirstPartyMediaUrlPair = {
  url: string;
  originalUrl: string;
};

export async function verifyFirstPartyMediaUrlPairsForUser({
  urls,
  originalUrls,
  max,
  clerkUserId,
  accountUserId,
  allowedEndpoints,
  allowedContentTypes = IMAGE_UPLOAD_TYPES,
}: {
  urls: string[];
  originalUrls: string[];
  max: number;
  clerkUserId: string;
  accountUserId: string;
  allowedEndpoints: readonly UploadEndpoint[];
  allowedContentTypes?: readonly string[];
}): Promise<
  | { ok: true; pairs: VerifiedFirstPartyMediaUrlPair[] }
  | { ok: false; error: string }
> {
  if (urls.length > max) {
    return { ok: false, error: `You can upload up to ${max} photos.` };
  }
  if (originalUrls.length > urls.length) {
    return {
      ok: false,
      error: "Listing photo details do not match. Re-upload the photos and try again.",
    };
  }

  const pairs: VerifiedFirstPartyMediaUrlPair[] = [];
  const uniqueUrls = new Set<string>();
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]?.trim() ?? "";
    const originalUrl = originalUrls[index]?.trim() || url;
    if (!url || !originalUrl) {
      return { ok: false, error: "A listing photo is missing. Re-upload it and try again." };
    }
    pairs.push({ url, originalUrl });
    uniqueUrls.add(url);
    uniqueUrls.add(originalUrl);
  }

  for (const url of uniqueUrls) {
    const result = await verifyFirstPartyMediaUrlForPersistence({
      url,
      allowedEndpoints,
      clerkUserId,
      accountUserId,
      allowedContentTypes,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
  }

  return { ok: true, pairs };
}
