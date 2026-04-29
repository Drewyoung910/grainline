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

export type BanAuditMetadata = {
  previousSellerProfile: BanSellerProfileSnapshot | null;
  previousCommissionRequests: BanCommissionRequestSnapshot[];
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

export function buildBanAuditMetadata({
  sellerProfile,
  commissionRequests,
}: {
  sellerProfile: BanSellerProfileSnapshot | null;
  commissionRequests: BanCommissionRequestSnapshot[];
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
  };
}

export function readBanAuditMetadata(metadata: unknown): BanAuditMetadata {
  if (!isRecord(metadata)) {
    return { previousSellerProfile: null, previousCommissionRequests: [] };
  }

  return {
    previousSellerProfile: readSellerProfileSnapshot(metadata.previousSellerProfile),
    previousCommissionRequests: readCommissionRequestSnapshots(metadata.previousCommissionRequests),
  };
}
