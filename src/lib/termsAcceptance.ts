export const CURRENT_TERMS_VERSION = "2026-03-30";

export type TermsAcceptanceState = {
  termsAcceptedAt: Date | string | null;
  termsVersion: string | null;
  ageAttestedAt: Date | string | null;
};

export function hasAcceptedCurrentTerms(state: TermsAcceptanceState | null | undefined): boolean {
  return Boolean(
    state?.termsAcceptedAt &&
      state.ageAttestedAt &&
      state.termsVersion === CURRENT_TERMS_VERSION,
  );
}

export function shouldRequireTermsAcceptance(state: TermsAcceptanceState | null | undefined): boolean {
  return !hasAcceptedCurrentTerms(state);
}
