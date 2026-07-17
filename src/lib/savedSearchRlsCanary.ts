export const SAVED_SEARCH_RLS_CANARY_USER_ID_ENV =
  "SAVED_SEARCH_RLS_CANARY_USER_ID";
export const SAVED_SEARCH_RLS_CANARY_SEARCH_ID_ENV =
  "SAVED_SEARCH_RLS_CANARY_SEARCH_ID";

const CANARY_USER_ID_PATTERN =
  /^rls-saved-search-canary-([a-f0-9]{12,32})-user$/;
const CANARY_SEARCH_ID_PATTERN =
  /^rls-saved-search-canary-([a-f0-9]{12,32})-search$/;

type CanaryEnvironment = Record<string, string | undefined>;

export type SavedSearchRlsCanaryLookup = (config: {
  searchId: string;
  userId: string;
}) => Promise<{
  exactMatch: boolean;
  matchCount: number;
}>;

export type SavedSearchRlsCanaryStatus =
  | "healthy"
  | "configuration_missing"
  | "configuration_partial"
  | "configuration_invalid"
  | "not_found"
  | "duplicate"
  | "wrong_row"
  | "invalid_result"
  | "query_failed";

export type SavedSearchRlsCanaryResult = {
  issueCount: 0 | 1;
  status: SavedSearchRlsCanaryStatus;
};

type ParsedCanaryConfiguration =
  | { result: SavedSearchRlsCanaryResult }
  | { searchId: string; userId: string };

export function parseSavedSearchRlsCanaryConfiguration(
  env: CanaryEnvironment,
): ParsedCanaryConfiguration {
  const userId = env[SAVED_SEARCH_RLS_CANARY_USER_ID_ENV];
  const searchId = env[SAVED_SEARCH_RLS_CANARY_SEARCH_ID_ENV];

  if (userId === undefined && searchId === undefined) {
    return { result: { issueCount: 1, status: "configuration_missing" } };
  }
  if (userId === undefined || searchId === undefined) {
    return { result: { issueCount: 1, status: "configuration_partial" } };
  }

  const userMatch = CANARY_USER_ID_PATTERN.exec(userId);
  const searchMatch = CANARY_SEARCH_ID_PATTERN.exec(searchId);
  if (
    userId !== userId.trim() ||
    searchId !== searchId.trim() ||
    !userMatch ||
    !searchMatch ||
    userMatch[1] !== searchMatch[1]
  ) {
    return { result: { issueCount: 1, status: "configuration_invalid" } };
  }

  return { searchId, userId };
}

export async function runSavedSearchRlsCanary(
  env: CanaryEnvironment,
  lookup: SavedSearchRlsCanaryLookup,
): Promise<SavedSearchRlsCanaryResult> {
  const configuration = parseSavedSearchRlsCanaryConfiguration(env);
  if ("result" in configuration) return configuration.result;

  try {
    const result = await lookup(configuration);
    if (
      typeof result.exactMatch !== "boolean" ||
      !Number.isInteger(result.matchCount) ||
      result.matchCount < 0
    ) {
      return { issueCount: 1, status: "invalid_result" };
    }
    if (result.matchCount === 0) {
      return { issueCount: 1, status: "not_found" };
    }
    if (result.matchCount > 1) {
      return { issueCount: 1, status: "duplicate" };
    }
    if (!result.exactMatch) {
      return { issueCount: 1, status: "wrong_row" };
    }
    return { issueCount: 0, status: "healthy" };
  } catch {
    // The cron result intentionally records no database error details because
    // a driver error can contain query parameters, including retained ids.
    return { issueCount: 1, status: "query_failed" };
  }
}
