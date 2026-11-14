import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import type { Category, CommissionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { CATEGORY_VALUES } from "@/lib/categories";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type QueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

const COMMISSION_STATUSES = new Set<CommissionStatus>([
  "OPEN",
  "IN_PROGRESS",
  "FULFILLED",
  "CLOSED",
  "EXPIRED",
]);

const CATEGORY_SET = new Set<string>(CATEGORY_VALUES);
const CAPABILITY_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export type PublicCommissionRequestRow = Readonly<{
  id: string;
  title: string;
  description: string;
  category: Category | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  timeline: string | null;
  referenceImageUrls: readonly string[];
  status: CommissionStatus;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isNational: boolean;
  buyerName: string | null;
  buyerImageUrl: string | null;
  buyerSellerCity: string | null;
  buyerSellerState: string | null;
  metroId: string | null;
  cityMetroId: string | null;
  distanceMeters: number | null;
}>;

export type PublicCommissionRequestDetail = PublicCommissionRequestRow & Readonly<{
  metro: Readonly<{ slug: string; name: string; state: string }> | null;
  cityMetro: Readonly<{ slug: string; name: string; state: string }> | null;
  isOwner: boolean;
  alreadyInterested: boolean;
}>;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validNullableDate(value: unknown): value is Date | null {
  return value === null || validDate(value);
}

function validNullableText(value: unknown, max: number): value is string | null {
  return value === null || isTextWithinCodePointRange(value, 0, max);
}

function validNullableMoney(value: unknown): value is number | null {
  return value === null
    || (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000_000);
}

function checkedPublicRow(value: unknown): PublicCommissionRequestRow {
  if (!value || typeof value !== "object") {
    throw new TypeError("Commission public authority returned an invalid row");
  }
  const row = value as Record<string, unknown>;
  if (
    !validId(row.id)
    || !isTextWithinCodePointRange(row.title, 1, 150)
    || !isTextWithinCodePointRange(row.description, 1, 5000)
    || (row.category !== null && (typeof row.category !== "string" || !CATEGORY_SET.has(row.category)))
    || !validNullableMoney(row.budgetMinCents)
    || !validNullableMoney(row.budgetMaxCents)
    || !validNullableText(row.timeline, 200)
    || !Array.isArray(row.referenceImageUrls)
    || row.referenceImageUrls.length > 3
    || row.referenceImageUrls.some((url) => typeof url !== "string" || url.length > 2048 || !url.startsWith("https://"))
    || typeof row.status !== "string"
    || !COMMISSION_STATUSES.has(row.status as CommissionStatus)
    || !validNullableDate(row.expiresAt)
    || !validDate(row.createdAt)
    || !validDate(row.updatedAt)
    || typeof row.isNational !== "boolean"
    || !validNullableText(row.buyerName, 100)
    || !validNullableText(row.buyerImageUrl, 2048)
    || !validNullableText(row.buyerSellerCity, 100)
    || !validNullableText(row.buyerSellerState, 50)
    || (row.metroId !== null && !validId(row.metroId))
    || (row.cityMetroId !== null && !validId(row.cityMetroId))
    || (row.distanceMeters !== null && (
      typeof row.distanceMeters !== "number"
      || !Number.isFinite(row.distanceMeters)
      || row.distanceMeters < 0
      || row.distanceMeters > 21_000_000
    ))
  ) {
    throw new TypeError("Commission public authority returned an invalid row");
  }
  return Object.freeze({
    id: row.id,
    title: row.title as string,
    description: row.description as string,
    category: row.category as Category | null,
    budgetMinCents: row.budgetMinCents as number | null,
    budgetMaxCents: row.budgetMaxCents as number | null,
    timeline: row.timeline as string | null,
    referenceImageUrls: Object.freeze([...(row.referenceImageUrls as string[])]),
    status: row.status as CommissionStatus,
    expiresAt: row.expiresAt as Date | null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    isNational: row.isNational as boolean,
    buyerName: row.buyerName as string | null,
    buyerImageUrl: row.buyerImageUrl as string | null,
    buyerSellerCity: row.buyerSellerCity as string | null,
    buyerSellerState: row.buyerSellerState as string | null,
    metroId: row.metroId as string | null,
    cityMetroId: row.cityMetroId as string | null,
    distanceMeters: row.distanceMeters as number | null,
  });
}

function normalizedOptionalId(value: string | null | undefined) {
  if (value == null) return null;
  if (!validId(value)) throw new RangeError("Commission authority id is invalid");
  return value;
}

function normalizedCategory(value: Category | null | undefined) {
  if (value == null) return null;
  if (!CATEGORY_SET.has(value)) throw new RangeError("Commission category is invalid");
  return value;
}

function validatePublicFilter(input: {
  category?: Category | null;
  metroId?: string | null;
  cityMetroId?: string | null;
  near?: Readonly<{ lat: number; lng: number; radiusMeters: number }> | null;
}) {
  if (input.metroId && input.cityMetroId) {
    throw new RangeError("Commission public query cannot select two metro scopes");
  }
  const near = input.near ?? null;
  if (near && (
    !Number.isFinite(near.lat)
    || near.lat < -90
    || near.lat > 90
    || !Number.isFinite(near.lng)
    || near.lng < -180
    || near.lng > 180
    || !Number.isSafeInteger(near.radiusMeters)
    || near.radiusMeters < 1000
    || near.radiusMeters > 500000
  )) {
    throw new RangeError("Commission near query is outside the supported range");
  }
  return Object.freeze({
    category: normalizedCategory(input.category),
    metroId: normalizedOptionalId(input.metroId),
    cityMetroId: normalizedOptionalId(input.cityMetroId),
    near,
  });
}

async function readPublicCount(
  client: QueryClient,
  input: ReturnType<typeof validatePublicFilter>,
) {
  const rows = await client.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_commission_request_public_count(
      ${input.category}::text,
      ${input.metroId}::text,
      ${input.cityMetroId}::text,
      ${input.near?.lat ?? null}::double precision,
      ${input.near?.lng ?? null}::double precision,
      ${input.near?.radiusMeters ?? null}::integer
    ) AS value
  `;
  const value = typeof rows[0]?.value === "bigint" ? Number(rows[0].value) : rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError("Commission public count authority returned an invalid result");
  }
  return value as number;
}

export function publicCommissionRequestCount(
  viewerUserId: string | null,
  input: Parameters<typeof validatePublicFilter>[0] = {},
) {
  const checked = validatePublicFilter(input);
  return viewerUserId
    ? withDbUserContext(viewerUserId, (client) => readPublicCount(client, checked))
    : readPublicCount(prisma, checked);
}

async function readPublicPage(
  client: QueryClient,
  input: ReturnType<typeof validatePublicFilter> & { offset: number; limit: number },
) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.grainline_commission_request_public_page(
      ${input.category}::text,
      ${input.metroId}::text,
      ${input.cityMetroId}::text,
      ${input.near?.lat ?? null}::double precision,
      ${input.near?.lng ?? null}::double precision,
      ${input.near?.radiusMeters ?? null}::integer,
      ${input.offset}::integer,
      ${input.limit}::integer
    )
  `;
  const publicRows: PublicCommissionRequestRow[] = [];
  for (const row of rows) {
    try {
      publicRows.push(checkedPublicRow(row));
    } catch (error) {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "commission_public_page_invalid_row" },
        extra: {
          rowId: validId(row.id) ? row.id : null,
        },
      });
    }
  }
  return Object.freeze({
    rows: Object.freeze(publicRows),
  });
}

export function publicCommissionRequestPage(
  viewerUserId: string | null,
  input: Parameters<typeof validatePublicFilter>[0] & { offset: number; limit: number },
) {
  if (
    !Number.isSafeInteger(input.offset)
    || input.offset < 0
    || input.offset > 999000
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || input.limit > 1000
  ) {
    throw new RangeError("Commission public page is outside the supported range");
  }
  const checked = Object.freeze({
    ...validatePublicFilter(input),
    offset: input.offset,
    limit: input.limit,
  });
  return viewerUserId
    ? withDbUserContext(viewerUserId, (client) => readPublicPage(client, checked))
    : readPublicPage(prisma, checked);
}

function optionalMetro(row: Record<string, unknown>, prefix: "metro" | "cityMetro") {
  const id = row[`${prefix}Id`];
  const slug = row[`${prefix}Slug`];
  const name = row[`${prefix}Name`];
  const state = row[`${prefix}State`];
  if (id === null && slug === null && name === null && state === null) return null;
  if (
    !validId(id)
    || !isTextWithinCodePointRange(slug, 1, 100)
    || !isTextWithinCodePointRange(name, 1, 100)
    || !isTextWithinCodePointRange(state, 1, 50)
  ) {
    throw new TypeError("Commission detail authority returned an invalid metro");
  }
  return Object.freeze({ slug, name, state });
}

async function readPublicDetail(client: QueryClient, requestId: string) {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM public.grainline_commission_request_public_detail(${requestId}::text)
  `;
  if (rows.length === 0) return null;
  const raw = rows[0];
  if (
    rows.length !== 1
    || !raw
    || typeof raw.isOwner !== "boolean"
    || typeof raw.alreadyInterested !== "boolean"
  ) {
    throw new TypeError("Commission detail authority returned an invalid result");
  }
  const base = checkedPublicRow({ ...raw, distanceMeters: null });
  return Object.freeze({
    ...base,
    metro: optionalMetro(raw, "metro"),
    cityMetro: optionalMetro(raw, "cityMetro"),
    isOwner: raw.isOwner,
    alreadyInterested: raw.alreadyInterested,
  }) satisfies PublicCommissionRequestDetail;
}

export function publicCommissionRequestDetail(viewerUserId: string | null, requestId: string) {
  if (!validId(requestId)) return Promise.resolve(null);
  return viewerUserId
    ? withDbUserContext(viewerUserId, (client) => readPublicDetail(client, requestId))
    : readPublicDetail(prisma, requestId);
}

export async function publicCommissionRequestSitemapPage(offset: number, limit: number) {
  if (
    !Number.isSafeInteger(offset)
    || offset < 0
    || offset > 999000
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 50000
  ) {
    throw new RangeError("Commission sitemap page is outside the supported range");
  }
  const rows = await prisma.$queryRaw<Array<{ id: unknown; updatedAt: unknown }>>`
    SELECT * FROM public.grainline_commission_request_public_sitemap_page(
      ${offset}::integer,
      ${limit}::integer
    )
  `;
  return Object.freeze(rows.map((row) => {
    if (!validId(row.id) || !validDate(row.updatedAt)) {
      throw new TypeError("Commission sitemap authority returned an invalid row");
    }
    return Object.freeze({ id: row.id, updatedAt: row.updatedAt });
  }));
}

export async function publicCommissionRequestMetroIds() {
  const rows = await prisma.$queryRaw<Array<{ id: unknown }>>`
    SELECT * FROM public.grainline_commission_request_public_metro_ids()
  `;
  const ids = new Set<string>();
  for (const row of rows) {
    if (!validId(row.id) || ids.has(row.id)) {
      throw new TypeError("Commission public metro authority returned an invalid row");
    }
    ids.add(row.id);
  }
  return ids;
}

export function actorCommissionInterestRequestIds(
  userId: string,
  commissionRequestIds: readonly string[],
) {
  const ids = [...new Set(commissionRequestIds)];
  if (
    ids.length < 1
    || ids.length > 1000
    || ids.some((id) => !validId(id))
    || ids.length !== commissionRequestIds.length
  ) {
    throw new RangeError("Commission interest actor request ids are invalid");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ commissionRequestId: unknown }>>`
      SELECT * FROM public.grainline_commission_interest_actor_request_ids(
        ${ids}::text[]
      )
    `;
    const result = new Set<string>();
    for (const row of rows) {
      if (
        !validId(row.commissionRequestId)
        || !ids.includes(row.commissionRequestId)
        || result.has(row.commissionRequestId)
      ) {
        throw new TypeError("Commission interest actor authority returned an invalid row");
      }
      result.add(row.commissionRequestId);
    }
    return result;
  });
}
export type OwnerCommissionRequestRow = Readonly<{
  id: string;
  title: string;
  description: string;
  category: Category | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  timeline: string | null;
  referenceImageUrls: readonly string[];
  status: CommissionStatus;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isNational: boolean;
  metroId: string | null;
  cityMetroId: string | null;
}>;

function checkedOwnerRow(value: unknown): OwnerCommissionRequestRow {
  if (!value || typeof value !== "object") {
    throw new TypeError("Commission owner authority returned an invalid row");
  }
  const row = value as Record<string, unknown>;
  const checked = checkedPublicRow({
    ...row,
    buyerName: null,
    buyerImageUrl: null,
    buyerSellerCity: null,
    buyerSellerState: null,
    distanceMeters: null,
  });
  return Object.freeze({
    id: checked.id,
    title: checked.title,
    description: checked.description,
    category: checked.category,
    budgetMinCents: checked.budgetMinCents,
    budgetMaxCents: checked.budgetMaxCents,
    timeline: checked.timeline,
    referenceImageUrls: checked.referenceImageUrls,
    status: checked.status,
    expiresAt: checked.expiresAt,
    createdAt: checked.createdAt,
    updatedAt: checked.updatedAt,
    isNational: checked.isNational,
    metroId: checked.metroId,
    cityMetroId: checked.cityMetroId,
  });
}

export function ownerCommissionRequestPage(userId: string, limit = 30) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("Commission owner page limit is invalid");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<unknown[]>`
      SELECT * FROM public.grainline_commission_request_owner_page(${limit}::integer)
    `;
    return Object.freeze(rows.map(checkedOwnerRow));
  });
}

export function ownerCommissionRequestExport(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM public.grainline_commission_request_owner_export()
    `;
    return Object.freeze(rows.map((row) => {
      const checked = checkedOwnerRow(row);
      const interestedCount = row.interestedCount;
      if (
        !Number.isSafeInteger(interestedCount)
        || Number(interestedCount) < 0
        || (row.lat !== null && (typeof row.lat !== "number" || !Number.isFinite(row.lat) || row.lat < -90 || row.lat > 90))
        || (row.lng !== null && (typeof row.lng !== "number" || !Number.isFinite(row.lng) || row.lng < -180 || row.lng > 180))
        || ((row.lat === null) !== (row.lng === null))
        || (row.radiusMeters !== null && (
          !Number.isSafeInteger(row.radiusMeters)
          || Number(row.radiusMeters) < 0
          || Number(row.radiusMeters) > 500000
        ))
      ) {
        throw new TypeError("Commission owner export authority returned an invalid count");
      }
      return Object.freeze({
        ...checked,
        interestedCount: interestedCount as number,
        lat: row.lat as number | null,
        lng: row.lng as number | null,
        radiusMeters: row.radiusMeters as number | null,
      });
    }));
  });
}

export async function ownerActiveCommissionRequestCount(
  client: DbUserContextTransactionClient,
) {
  const rows = await client.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_commission_request_owner_active_count() AS value
  `;
  const value = typeof rows[0]?.value === "bigint" ? Number(rows[0].value) : rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError("Commission owner active count authority returned an invalid result");
  }
  return value as number;
}

export async function ownerCommissionReferenceImageUrls(
  client: DbUserContextTransactionClient,
) {
  const rows = await client.$queryRaw<Array<{ url: unknown }>>`
    SELECT * FROM public.grainline_commission_request_owner_reference_image_urls()
  `;
  const urls = new Set<string>();
  for (const row of rows) {
    if (
      typeof row.url !== "string"
      || row.url.length < 1
      || row.url.length > 2048
      || !row.url.startsWith("https://")
      || urls.has(row.url)
    ) {
      throw new TypeError("Commission owner media authority returned an invalid row");
    }
    urls.add(row.url);
  }
  return Object.freeze([...urls]);
}

export function ownerCommissionInterestExport(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{
      commissionRequestId: unknown;
      conversationId: unknown;
      createdAt: unknown;
    }>>`
      SELECT * FROM public.grainline_commission_interest_owner_export()
    `;
    return Object.freeze(rows.map((row) => {
      if (
        !validId(row.commissionRequestId)
        || (row.conversationId !== null && !validId(row.conversationId))
        || !validDate(row.createdAt)
      ) {
        throw new TypeError("Commission interest owner export authority returned an invalid row");
      }
      return Object.freeze({
        commissionRequestId: row.commissionRequestId,
        conversationId: row.conversationId as string | null,
        createdAt: row.createdAt,
      });
    }));
  });
}

export type CreateOwnerCommissionRequestInput = Readonly<{
  title: string;
  description: string;
  category: Category | null;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
  timeline: string | null;
  referenceImageUrls: readonly string[];
  isNational: boolean;
  lat: number | null;
  lng: number | null;
  radiusMeters: number | null;
}>;

export function createOwnerCommissionRequest(
  userId: string,
  input: CreateOwnerCommissionRequestInput,
) {
  if (
    !isTextWithinCodePointRange(input.title, 1, 150)
    || !isTextWithinCodePointRange(input.description, 1, 5000)
    || (input.category !== null && !CATEGORY_SET.has(input.category))
    || !validNullableMoney(input.budgetMinCents)
    || !validNullableMoney(input.budgetMaxCents)
    || (input.budgetMinCents !== null && input.budgetMaxCents !== null
      && input.budgetMaxCents < input.budgetMinCents)
    || (input.timeline !== null && !isTextWithinCodePointRange(input.timeline, 1, 200))
    || input.referenceImageUrls.length > 3
    || input.referenceImageUrls.some((url) => url.length > 2048 || !url.startsWith("https://"))
    || (input.isNational && (input.lat !== null || input.lng !== null))
    || (!input.isNational && (
      input.lat === null
      || input.lng === null
      || !Number.isFinite(input.lat)
      || input.lat < -90
      || input.lat > 90
      || !Number.isFinite(input.lng)
      || input.lng < -180
      || input.lng > 180
      || !Number.isSafeInteger(input.radiusMeters)
      || Number(input.radiusMeters) < 5000
      || Number(input.radiusMeters) > 500000
    ))
  ) {
    throw new RangeError("Commission owner create input is invalid");
  }
  const requestId = randomUUID();
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{
      id: unknown;
      expiresAt: unknown;
      createdAt: unknown;
    }>>`
      SELECT * FROM public.grainline_commission_request_owner_create(
        ${requestId}::text,
        ${input.title}::text,
        ${input.description}::text,
        ${input.category}::text,
        ${input.budgetMinCents}::integer,
        ${input.budgetMaxCents}::integer,
        ${input.timeline}::text,
        ${[...input.referenceImageUrls]}::text[],
        ${input.isNational}::boolean,
        ${input.lat}::double precision,
        ${input.lng}::double precision,
        ${input.radiusMeters}::integer
      )
    `;
    const created = rows[0];
    if (
      rows.length !== 1
      || created?.id !== requestId
      || !validDate(created.expiresAt)
      || !validDate(created.createdAt)
    ) {
      throw new TypeError("Commission owner create authority returned an invalid result");
    }
    return Object.freeze({
      id: requestId,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
    });
  });
}

export function assignOwnerCommissionRequestMetros(
  userId: string,
  requestId: string,
  metroId: string | null,
  cityMetroId: string | null,
) {
  if (!validId(requestId)) throw new RangeError("Commission request id is invalid");
  const checkedMetroId = normalizedOptionalId(metroId);
  const checkedCityMetroId = normalizedOptionalId(cityMetroId);
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ value: unknown }>>`
      SELECT public.grainline_commission_request_owner_assign_metros(
        ${requestId}::text,
        ${checkedMetroId}::text,
        ${checkedCityMetroId}::text
      ) AS value
    `;
    if (rows.length !== 1 || typeof rows[0]?.value !== "boolean") {
      throw new TypeError("Commission metro authority returned an invalid result");
    }
    return rows[0].value;
  });
}

export function transitionOwnerCommissionRequest(
  userId: string,
  requestId: string,
  status: "FULFILLED" | "CLOSED",
) {
  if (!validId(requestId) || (status !== "FULFILLED" && status !== "CLOSED")) {
    throw new RangeError("Commission owner transition input is invalid");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{
      outcome: unknown;
      requestId: unknown;
      title: unknown;
      status: unknown;
      sellerUserIds: unknown;
    }>>`
      SELECT * FROM public.grainline_commission_request_owner_transition(
        ${requestId}::text,
        ${status}::text
      )
    `;
    const row = rows[0];
    if (
      rows.length !== 1
      || !row
      || typeof row.outcome !== "string"
      || !["not_found", "not_open", "needs_interest", "transitioned"].includes(row.outcome)
      || !Array.isArray(row.sellerUserIds)
      || row.sellerUserIds.some((id) => !validId(id))
      || new Set(row.sellerUserIds).size !== row.sellerUserIds.length
      || (row.outcome === "not_found" && (
        row.requestId !== null || row.title !== null || row.status !== null
      ))
      || (row.outcome !== "not_found" && (
        row.requestId !== requestId
        || !isTextWithinCodePointRange(row.title, 1, 150)
        || typeof row.status !== "string"
        || !COMMISSION_STATUSES.has(row.status as CommissionStatus)
      ))
      || (row.outcome === "transitioned" && row.status !== status)
    ) {
      throw new TypeError("Commission owner transition authority returned an invalid result");
    }
    return Object.freeze({
      outcome: row.outcome as "not_found" | "not_open" | "needs_interest" | "transitioned",
      requestId: row.requestId as string | null,
      title: row.title as string | null,
      status: row.status as CommissionStatus | null,
      sellerUserIds: Object.freeze([...(row.sellerUserIds as string[])]),
    });
  });
}

export async function prepareCommissionAccountDeletion(
  client: DbUserContextTransactionClient,
  input: {
    sideEffectId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
) {
  if (
    !validId(input.sideEffectId)
    || input.claimGeneration < 1n
    || !CAPABILITY_ID_PATTERN.test(input.claimToken)
  ) {
    throw new RangeError("Commission account-deletion claim is invalid");
  }
  const rows = await client.$queryRaw<Array<{
    closedRequestCount: unknown;
    removedInterestCount: unknown;
  }>>`
    SELECT * FROM public.grainline_commission_account_deletion_prepare(
      ${input.sideEffectId}::text,
      ${input.claimGeneration}::bigint,
      ${input.claimToken}::uuid
    )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || !Number.isSafeInteger(row?.closedRequestCount)
    || Number(row.closedRequestCount) < 0
    || !Number.isSafeInteger(row.removedInterestCount)
    || Number(row.removedInterestCount) < 0
  ) {
    throw new TypeError("Commission account-deletion preparation returned an invalid result");
  }
  return Object.freeze({
    closedRequestCount: row.closedRequestCount as number,
    removedInterestCount: row.removedInterestCount as number,
  });
}

export async function redactCommissionAccountDeletion(
  client: DbUserContextTransactionClient,
  input: {
    sideEffectId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
) {
  if (
    !validId(input.sideEffectId)
    || input.claimGeneration < 1n
    || !CAPABILITY_ID_PATTERN.test(input.claimToken)
  ) {
    throw new RangeError("Commission account-deletion claim is invalid");
  }
  const rows = await client.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_commission_account_deletion_redact(
      ${input.sideEffectId}::text,
      ${input.claimGeneration}::bigint,
      ${input.claimToken}::uuid
    ) AS value
  `;
  const value = rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError("Commission account-deletion redaction returned an invalid result");
  }
  return value as number;
}

export type CommissionBanRequestSnapshot = Readonly<{
  id: string;
  status: "OPEN" | "IN_PROGRESS";
}>;

export async function closeCommissionRequestsForStaffBan(
  client: DbUserContextTransactionClient,
  capabilityId: string,
  targetUserId: string,
) {
  if (!CAPABILITY_ID_PATTERN.test(capabilityId) || !validId(targetUserId)) {
    throw new RangeError("Commission ban authority input is invalid");
  }
  const rows = await client.$queryRaw<Array<{ id: unknown; status: unknown }>>`
    SELECT * FROM public.grainline_commission_request_staff_ban_close(
      ${capabilityId}::text,
      ${targetUserId}::text
    )
  `;
  const ids = new Set<string>();
  return Object.freeze(rows.map((row) => {
    if (
      !validId(row.id)
      || ids.has(row.id)
      || (row.status !== "OPEN" && row.status !== "IN_PROGRESS")
    ) {
      throw new TypeError("Commission staff ban authority returned an invalid row");
    }
    ids.add(row.id);
    return Object.freeze({
      id: row.id,
      status: row.status,
    }) satisfies CommissionBanRequestSnapshot;
  }));
}

export async function restoreCommissionRequestsForStaffBan(
  client: DbUserContextTransactionClient,
  capabilityId: string,
  targetUserId: string,
  requests: readonly CommissionBanRequestSnapshot[],
) {
  if (
    !CAPABILITY_ID_PATTERN.test(capabilityId)
    || !validId(targetUserId)
    || requests.length > 1000
    || new Set(requests.map((request) => request.id)).size !== requests.length
    || requests.some((request) => (
      !validId(request.id)
      || (request.status !== "OPEN" && request.status !== "IN_PROGRESS")
    ))
  ) {
    throw new RangeError("Commission ban restoration input is invalid");
  }
  const rows = await client.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_commission_request_staff_ban_restore(
      ${capabilityId}::text,
      ${targetUserId}::text,
      ${requests.map((request) => request.id)}::text[],
      ${requests.map((request) => request.status)}::text[]
    ) AS value
  `;
  const value = rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || value !== requests.length) {
    throw new TypeError("Commission staff restore authority returned an invalid result");
  }
  return value;
}

export async function expireCommissionRequestBatch(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new RangeError("Commission expiry batch limit is invalid");
  }
  const rows = await prisma.$queryRaw<Array<{
    requestId: unknown;
    title: unknown;
    buyerUserId: unknown;
    sellerUserIds: unknown;
  }>>`
    SELECT * FROM public.grainline_commission_request_service_expire_batch(
      ${limit}::integer
    )
  `;
  return Object.freeze(rows.map((row) => {
    if (
      !validId(row.requestId)
      || !isTextWithinCodePointRange(row.title, 0, 150)
      || !validId(row.buyerUserId)
      || !Array.isArray(row.sellerUserIds)
      || row.sellerUserIds.length > 10000
      || row.sellerUserIds.some((id) => !validId(id) || id === row.buyerUserId)
      || new Set(row.sellerUserIds).size !== row.sellerUserIds.length
    ) {
      throw new TypeError("Commission expiry authority returned an invalid row");
    }
    return Object.freeze({
      requestId: row.requestId,
      title: row.title as string,
      buyerUserId: row.buyerUserId,
      sellerUserIds: Object.freeze([...(row.sellerUserIds as string[])]),
    });
  }));
}

export async function expiredCommissionRequestCount() {
  const rows = await prisma.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_commission_request_service_expired_count() AS value
  `;
  const value = typeof rows[0]?.value === "bigint" ? Number(rows[0].value) : rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError("Commission expiry count authority returned an invalid result");
  }
  return value as number;
}
