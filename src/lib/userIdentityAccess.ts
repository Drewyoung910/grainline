import { randomUUID } from "node:crypto";
import type { Prisma, User } from "@prisma/client";

type UserIdentityClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type UserIdentityEnsureRow = {
  user_id: string;
  email_conflict: boolean;
  created: boolean;
};

export type UserClerkGate = Pick<
  User,
  | "id"
  | "role"
  | "banned"
  | "deletedAt"
  | "termsAcceptedAt"
  | "termsVersion"
  | "ageAttestedAt"
>;

type UserClerkId = Pick<User, "id">;

export type UserClerkActor = Pick<
  User,
  "id" | "name" | "banned" | "deletedAt"
>;

export type UserClerkLifecycleState = Pick<
  User,
  "id" | "banned" | "deletedAt"
> & { email: string | null };

type UserClerkWelcomeReservationRow = {
  reserved: boolean;
};

type UserClerkCommissionContextRow = UserClerkActor & {
  sellerProfileId: string | null;
  sellerDisplayName: string | null;
  sellerAvatarImageUrl: string | null;
  sellerChargesEnabled: boolean | null;
  sellerVacationMode: boolean | null;
  sellerLat: number | null;
  sellerLng: number | null;
  sellerRadiusMeters: number | null;
};

export type UserClerkCommissionContext = UserClerkActor & {
  sellerProfile: null | {
    id: string;
    displayName: string;
    avatarImageUrl: string | null;
    chargesEnabled: boolean;
    vacationMode: boolean;
    lat: number | null;
    lng: number | null;
    radiusMeters: number | null;
  };
};

function validOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validOptionalNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function validUserClerkActor(row: UserClerkActor | undefined): row is UserClerkActor {
  return Boolean(
    row
    && typeof row.id === "string"
    && validOptionalString(row.name)
    && typeof row.banned === "boolean"
    && (row.deletedAt === null || row.deletedAt instanceof Date),
  );
}

function validUserClerkLifecycleState(
  row: UserClerkLifecycleState | undefined,
): row is UserClerkLifecycleState {
  const blocked = Boolean(row?.banned || row?.deletedAt);
  return Boolean(
    row
    && typeof row.id === "string"
    && (blocked ? row.email === null : typeof row.email === "string")
    && typeof row.banned === "boolean"
    && (row.deletedAt === null || row.deletedAt instanceof Date),
  );
}

function validUserRow(row: User | undefined, clerkId: string): row is User {
  return Boolean(
    row
    && typeof row.id === "string"
    && row.clerkId === clerkId
    && typeof row.email === "string"
    && typeof row.role === "string"
    && row.createdAt instanceof Date
    && row.updatedAt instanceof Date
    && typeof row.banned === "boolean"
    && (row.deletedAt === null || row.deletedAt instanceof Date),
  );
}

export async function userAccountByClerkId(
  client: UserIdentityClient,
  clerkId: string,
) {
  const rows = await client.$queryRaw<User[]>`
    SELECT *
      FROM public.grainline_user_clerk_account(${clerkId}::text)
  `;
  if (rows.length > 1 || (rows[0] && !validUserRow(rows[0], clerkId))) {
    throw new Error("Clerk account authority returned an invalid result");
  }
  return rows[0] ?? null;
}

export async function userClerkGate(
  client: UserIdentityClient,
  clerkId: string,
) {
  const rows = await client.$queryRaw<UserClerkGate[]>`
    SELECT *
      FROM public.grainline_user_clerk_gate(${clerkId}::text)
  `;
  const gate = rows[0];
  if (
    rows.length > 1
    || (gate && (
      typeof gate.id !== "string"
      || typeof gate.role !== "string"
      || typeof gate.banned !== "boolean"
      || (gate.deletedAt !== null && !(gate.deletedAt instanceof Date))
      || (gate.termsAcceptedAt !== null && !(gate.termsAcceptedAt instanceof Date))
      || (gate.termsVersion !== null && typeof gate.termsVersion !== "string")
      || (gate.ageAttestedAt !== null && !(gate.ageAttestedAt instanceof Date))
    ))
  ) {
    throw new Error("Clerk account gate authority returned an invalid result");
  }
  return gate ?? null;
}

export async function userIdByClerkId(
  client: UserIdentityClient,
  clerkId: string,
) {
  const rows = await client.$queryRaw<UserClerkId[]>`
    SELECT id
      FROM public.grainline_user_clerk_gate(${clerkId}::text)
  `;
  const user = rows[0];
  if (rows.length > 1 || (user && typeof user.id !== "string")) {
    throw new Error("Clerk local-id authority returned an invalid result");
  }
  return user ?? null;
}

export async function userClerkActor(
  client: UserIdentityClient,
  clerkId: string,
) {
  const rows = await client.$queryRaw<UserClerkActor[]>`
    SELECT *
      FROM public.grainline_user_clerk_actor(${clerkId}::text)
  `;
  const actor = rows[0];
  if (rows.length > 1 || (actor && !validUserClerkActor(actor))) {
    throw new Error("Clerk actor authority returned an invalid result");
  }
  return actor ?? null;
}

export async function userClerkLifecycleState(
  client: UserIdentityClient,
  clerkId: string,
) {
  const rows = await client.$queryRaw<UserClerkLifecycleState[]>`
    SELECT *
      FROM public.grainline_user_clerk_lifecycle_state(${clerkId}::text)
  `;
  const state = rows[0];
  if (
    rows.length > 1
    || (state && !validUserClerkLifecycleState(state))
  ) {
    throw new Error("Clerk provider lifecycle authority returned an invalid result");
  }
  return state ?? null;
}

export async function reserveUserClerkWelcomeEmail(
  client: UserIdentityClient,
  input: { clerkId: string; userId: string },
) {
  const rows = await client.$queryRaw<UserClerkWelcomeReservationRow[]>`
    SELECT public.grainline_user_clerk_welcome_reserve(
      ${input.clerkId}::text,
      ${input.userId}::text
    ) AS reserved
  `;
  const outcome = rows[0];
  if (
    rows.length !== 1
    || !outcome
    || typeof outcome.reserved !== "boolean"
  ) {
    throw new Error("Clerk welcome reservation authority returned an invalid result");
  }
  return outcome.reserved;
}

export async function userClerkCommissionContext(
  client: UserIdentityClient,
  clerkId: string,
): Promise<UserClerkCommissionContext | null> {
  const rows = await client.$queryRaw<UserClerkCommissionContextRow[]>`
    SELECT *
      FROM public.grainline_user_clerk_commission_context(${clerkId}::text)
  `;
  const row = rows[0];
  const hasSeller = row?.sellerProfileId !== null;
  const validSeller = !row || !hasSeller || (
    typeof row.sellerProfileId === "string"
    && typeof row.sellerDisplayName === "string"
    && validOptionalString(row.sellerAvatarImageUrl)
    && typeof row.sellerChargesEnabled === "boolean"
    && typeof row.sellerVacationMode === "boolean"
    && validOptionalNumber(row.sellerLat)
    && validOptionalNumber(row.sellerLng)
    && (row.sellerRadiusMeters === null || Number.isSafeInteger(row.sellerRadiusMeters))
  );
  const emptySeller = !row || hasSeller || (
    row.sellerDisplayName === null
    && row.sellerAvatarImageUrl === null
    && row.sellerChargesEnabled === null
    && row.sellerVacationMode === null
    && row.sellerLat === null
    && row.sellerLng === null
    && row.sellerRadiusMeters === null
  );
  if (
    rows.length > 1
    || (row && !validUserClerkActor(row))
    || !validSeller
    || !emptySeller
  ) {
    throw new Error("Clerk commission authority returned an invalid result");
  }
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    banned: row.banned,
    deletedAt: row.deletedAt,
    sellerProfile: row.sellerProfileId === null ? null : {
      id: row.sellerProfileId,
      displayName: row.sellerDisplayName as string,
      avatarImageUrl: row.sellerAvatarImageUrl,
      chargesEnabled: row.sellerChargesEnabled as boolean,
      vacationMode: row.sellerVacationMode as boolean,
      lat: row.sellerLat,
      lng: row.sellerLng,
      radiusMeters: row.sellerRadiusMeters,
    },
  };
}

export async function ensureUserIdentityByClerkId(
  client: UserIdentityClient,
  input: {
    clerkId: string;
    email?: string;
    name?: string | null;
    imageUrl?: string | null;
  },
) {
  const hasEmail = Object.hasOwn(input, "email");
  const hasName = Object.hasOwn(input, "name");
  const hasImage = Object.hasOwn(input, "imageUrl");
  const rows = await client.$queryRaw<UserIdentityEnsureRow[]>`
    SELECT *
      FROM public.grainline_user_clerk_identity_ensure(
        ${randomUUID()}::text,
        ${input.clerkId}::text,
        ${hasEmail ? input.email ?? null : null}::text,
        ${hasEmail}::boolean,
        ${hasName ? input.name ?? null : null}::text,
        ${hasName}::boolean,
        ${hasImage ? input.imageUrl ?? null : null}::text,
        ${hasImage}::boolean
      )
  `;
  const outcome = rows[0];
  if (
    rows.length !== 1
    || !outcome
    || typeof outcome.user_id !== "string"
    || typeof outcome.email_conflict !== "boolean"
    || typeof outcome.created !== "boolean"
  ) {
    throw new Error("Clerk identity authority returned an invalid result");
  }
  const user = await userAccountByClerkId(client, input.clerkId);
  if (!user || user.id !== outcome.user_id) {
    throw new Error("Clerk identity authority did not return its account");
  }
  return {
    user,
    emailConflict: outcome.email_conflict,
    created: outcome.created,
  };
}
