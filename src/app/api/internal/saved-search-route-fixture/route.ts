import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withSerializableDbUserContext, withDbUserContext } from "@/lib/dbUserContext";
import {
  createOwnerSavedSearch,
  deleteAllOwnerSavedSearches,
  deleteOwnerSavedSearch,
  listOwnerSavedSearches,
  type OwnerSavedSearchCriteria,
} from "@/lib/savedSearchOwnerAccess";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { safeRateLimit, savedSearchRatelimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const BODY_MAX_BYTES = 1024;
const RequestSchema = z.object({
  token: z.string().min(32).max(256),
}).strict();
const criteria: OwnerSavedSearchCriteria = {
  query: "__grainline_saved_search_route_fixture__",
  category: "FURNITURE",
  listingType: "IN_STOCK",
  shipsWithinDays: 7,
  minRating: 4,
  lat: 40.71,
  lng: -74.01,
  radiusMiles: 25,
  sort: "newest",
  minPrice: 101,
  maxPrice: 909,
  tags: ["route-fixture", "saved-search"],
};

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isAuthorized(provided: string) {
  const expected = process.env.SAVED_SEARCH_ROUTE_FIXTURE_TRIGGER_SECRET;
  return Boolean(expected) && timingSafeEqual(digest(provided), digest(expected!));
}

function providerRunIsPinned() {
  const allowedCommitSha = process.env.SAVED_SEARCH_ROUTE_FIXTURE_ALLOWED_COMMIT_SHA;
  return Boolean(allowedCommitSha) && allowedCommitSha === process.env.VERCEL_GIT_COMMIT_SHA;
}

function privateJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}

function exactFixtureRow(rows: Awaited<ReturnType<typeof listOwnerSavedSearches>>, id: string) {
  return rows.length === 1 && rows[0]?.id === id && rows[0]?.query === criteria.query;
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") {
    return new Response("Not found", { status: 404 });
  }

  let parsed: z.infer<typeof RequestSchema>;
  try {
    parsed = RequestSchema.parse(await readBoundedJson(request, BODY_MAX_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) return privateJson({ error: "Request body too large" }, 413);
    if (isInvalidJsonBodyError(error) || error instanceof z.ZodError) {
      return privateJson({ error: "Invalid request" }, 400);
    }
    return privateJson({ error: "Invalid request" }, 400);
  }

  if (!isAuthorized(parsed.token)) return privateJson({ error: "Unauthorized" }, 401);
  if (!providerRunIsPinned()) return privateJson({ error: "Runner is not pinned to this commit" }, 403);
  const { success } = await safeRateLimit(
    savedSearchRatelimit,
    `saved-search-route-fixture:${digest(parsed.token).toString("hex")}`,
  );
  if (!success) return privateJson({ error: "Too many requests" }, 429);

  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const userA = `rls-route-fixture-${suffix}-a`;
  const userB = `rls-route-fixture-${suffix}-b`;
  const checks: Array<{ name: string; status: "passed" }> = [];
  let cleanupVerified = false;

  const record = (name: string, passed: boolean) => {
    if (!passed) throw new Error("SavedSearch route fixture assertion failed");
    checks.push({ name, status: "passed" });
  };

  try {
    await prisma.user.createMany({
      data: [
        {
          id: userA,
          clerkId: `rls-route-fixture:${suffix}:a`,
          email: `rls-route-fixture-${suffix}-a@example.invalid`,
          banned: true,
          bannedAt: new Date(),
          banReason: "Synthetic SavedSearch route fixture",
        },
        {
          id: userB,
          clerkId: `rls-route-fixture:${suffix}:b`,
          email: `rls-route-fixture-${suffix}-b@example.invalid`,
          banned: true,
          bannedAt: new Date(),
          banReason: "Synthetic SavedSearch route fixture",
        },
      ],
    });
    const searchA = await withSerializableDbUserContext(userA, (tx) =>
      createOwnerSavedSearch(userA, criteria, tx));
    const searchB = await withSerializableDbUserContext(userB, (tx) =>
      createOwnerSavedSearch(userB, { ...criteria, query: `${criteria.query}_foreign` }, tx));
    record("API exact-id read", exactFixtureRow(
      await listOwnerSavedSearches(userA, prisma, { take: 2, searchId: searchA.id }),
      searchA.id,
    ));
    record("account overview exact-id read", exactFixtureRow(
      await listOwnerSavedSearches(userA, prisma, { take: 3, searchId: searchA.id }),
      searchA.id,
    ));
    record("dashboard exact-id read", exactFixtureRow(
      await listOwnerSavedSearches(userA, prisma, { take: 20, searchId: searchA.id }),
      searchA.id,
    ));
    record("account export exact-id read", exactFixtureRow(
      await listOwnerSavedSearches(userA, prisma, { searchId: searchA.id }),
      searchA.id,
    ));
    record(
      "foreign exact-id read returns zero rows",
      (await listOwnerSavedSearches(userB, prisma, { take: 2, searchId: searchA.id })).length === 0,
    );
    record(
      "foreign delete RPC affects zero rows",
      (await deleteOwnerSavedSearch(userB, searchA.id, prisma)).count === 0,
    );
    record(
      "owner delete RPC affects exactly one row",
      (await deleteOwnerSavedSearch(userB, searchB.id, prisma)).count === 1,
    );
    const accountCleanup = await withDbUserContext(userA, (tx) =>
      deleteAllOwnerSavedSearches(userA, tx), { timeout: 30_000, maxWait: 10_000 });
    record("account cleanup deletes the exact owner row", accountCleanup.count === 1);
    record(
      "post-account-cleanup owner list is empty",
      (await listOwnerSavedSearches(userA, prisma, { take: 2 })).length === 0,
    );
    const resetRows = await prisma.$queryRaw<Array<{ user_id: string | null }>>`
      SELECT current_setting('app.user_id', true) AS user_id
    `;
    record("pooled context is reset after route fixture", (resetRows[0]?.user_id ?? "") === "");
  } catch {
    return privateJson({ error: "SavedSearch route fixture failed" }, 500);
  } finally {
    for (const userId of [userA, userB]) {
      await withDbUserContext(userId, (tx) => deleteAllOwnerSavedSearches(userId, tx), {
        timeout: 30_000,
        maxWait: 10_000,
      }).catch(() => undefined);
    }
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } }).catch(() => undefined);
    const remainingUsers = await prisma.user.count({ where: { id: { in: [userA, userB] } } })
      .catch(() => -1);
    cleanupVerified = remainingUsers === 0;
  }

  if (!cleanupVerified) return privateJson({ error: "SavedSearch route fixture cleanup failed" }, 500);
  return privateJson({
    acceptanceEligible: true,
    cleanupVerified,
    checkCount: checks.length,
    checks,
    issueCount: 0,
    status: "passed",
    target: {
      runtimeRole: "grainline_app_runtime",
      table: "SavedSearch",
      transport: "pooled",
    },
  });
}
