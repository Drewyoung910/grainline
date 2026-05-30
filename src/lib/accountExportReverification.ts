export const ACCOUNT_EXPORT_REVERIFICATION = {
  level: "first_factor",
  afterMinutes: 10,
} as const;

export type FactorVerificationAge = readonly [firstFactorAge: number, secondFactorAge: number] | null;

function isFactorAge(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= -1;
}

export function hasFreshAccountExportSession(factorVerificationAge: FactorVerificationAge) {
  if (
    !Array.isArray(factorVerificationAge) ||
    factorVerificationAge.length !== 2 ||
    !isFactorAge(factorVerificationAge[0]) ||
    !isFactorAge(factorVerificationAge[1])
  ) {
    return false;
  }

  const [firstFactorAge] = factorVerificationAge;
  return firstFactorAge >= 0 && firstFactorAge < ACCOUNT_EXPORT_REVERIFICATION.afterMinutes;
}
