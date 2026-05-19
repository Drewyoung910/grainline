import { createHash } from "node:crypto";
import { CommissionStatus } from "@prisma/client";

const COMMISSION_STATUSES = new Set<string>(Object.values(CommissionStatus));

export type BanSellerProfileSnapshot = {
  id: string;
  chargesEnabled: boolean;
  vacationMode: boolean;
};

export type BanCommissionRequestSnapshot = {
  id: string;
  status: CommissionStatus;
};

export type BanOpenOrderSnapshot = {
  id: string;
  buyerId: string | null;
  previousReviewNeeded: boolean;
  previousReviewNoteHash: string | null;
  previousReviewNoteLength: number;
};

export type BanOpenOrderInput = {
  id: string;
  buyerId: string | null;
  previousReviewNeeded: boolean;
  previousReviewNote?: string | null;
};

export type BanAuditMetadata = {
  previousSellerProfile: BanSellerProfileSnapshot | null;
  previousCommissionRequests: BanCommissionRequestSnapshot[];
  flaggedOpenOrders: BanOpenOrderSnapshot[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readSellerProfileSnapshot(value: unknown): BanSellerProfileSnapshot | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.chargesEnabled !== "boolean") return null;
  if (typeof value.vacationMode !== "boolean") return null;
  return {
    id: value.id,
    chargesEnabled: value.chargesEnabled,
    vacationMode: value.vacationMode,
  };
}

function readCommissionRequestSnapshots(value: unknown): BanCommissionRequestSnapshot[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.id !== "string") return [];
    if (typeof item.status !== "string" || !COMMISSION_STATUSES.has(item.status)) return [];
    return [{ id: item.id, status: item.status as CommissionStatus }];
  });
}

function readOpenOrderSnapshots(value: unknown): BanOpenOrderSnapshot[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.id !== "string") return [];
    if (item.buyerId !== null && typeof item.buyerId !== "string") return [];
    if (typeof item.previousReviewNeeded !== "boolean") return [];
    const legacyReviewNote = typeof item.previousReviewNote === "string" ? item.previousReviewNote : null;
    const legacySnapshot = reviewNoteSnapshot(legacyReviewNote);
    const previousReviewNoteHash =
      typeof item.previousReviewNoteHash === "string" || item.previousReviewNoteHash === null
        ? item.previousReviewNoteHash
        : legacySnapshot.previousReviewNoteHash;
    const previousReviewNoteLength =
      typeof item.previousReviewNoteLength === "number" && Number.isSafeInteger(item.previousReviewNoteLength)
        ? item.previousReviewNoteLength
        : legacySnapshot.previousReviewNoteLength;
    return [{
      id: item.id,
      buyerId: item.buyerId,
      previousReviewNeeded: item.previousReviewNeeded,
      previousReviewNoteHash,
      previousReviewNoteLength,
    }];
  });
}

function reviewNoteSnapshot(note: string | null) {
  if (!note) return { previousReviewNoteHash: null, previousReviewNoteLength: 0 };
  return {
    previousReviewNoteHash: createHash("sha256").update(note).digest("hex"),
    previousReviewNoteLength: Array.from(note).length,
  };
}

export function buildBanAuditMetadata({
  sellerProfile,
  commissionRequests,
  openOrders = [],
}: {
  sellerProfile: BanSellerProfileSnapshot | null;
  commissionRequests: BanCommissionRequestSnapshot[];
  openOrders?: BanOpenOrderInput[];
}): BanAuditMetadata {
  return {
    previousSellerProfile: sellerProfile
      ? {
          id: sellerProfile.id,
          chargesEnabled: sellerProfile.chargesEnabled,
          vacationMode: sellerProfile.vacationMode,
        }
      : null,
    previousCommissionRequests: commissionRequests.map((request) => ({
      id: request.id,
      status: request.status,
    })),
    flaggedOpenOrders: openOrders.map((order) => ({
      id: order.id,
      buyerId: order.buyerId,
      previousReviewNeeded: order.previousReviewNeeded,
      ...reviewNoteSnapshot(order.previousReviewNote ?? null),
    })),
  };
}

export function readBanAuditMetadata(metadata: unknown): BanAuditMetadata {
  if (!isRecord(metadata)) {
    return { previousSellerProfile: null, previousCommissionRequests: [], flaggedOpenOrders: [] };
  }

  return {
    previousSellerProfile: readSellerProfileSnapshot(metadata.previousSellerProfile),
    previousCommissionRequests: readCommissionRequestSnapshots(metadata.previousCommissionRequests),
    flaggedOpenOrders: readOpenOrderSnapshots(metadata.flaggedOpenOrders),
  };
}
