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
