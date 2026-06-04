export const CURRENT_TERMS_VERSION = "2026-06-04";

export type TermsAcceptanceState = {
  termsAcceptedAt: Date | string | null;
  termsVersion: string | null;
  ageAttestedAt: Date | string | null;
};

export type TermsAcceptanceMutationState = {
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
  ageAttestedAt: Date | null;
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

export function currentTermsAcceptanceUpdate(
  state: TermsAcceptanceMutationState | null | undefined,
  acceptedAt = new Date(),
) {
  if (state?.termsAcceptedAt && state.ageAttestedAt && state.termsVersion === CURRENT_TERMS_VERSION) {
    return {
      termsAcceptedAt: state.termsAcceptedAt,
      ageAttestedAt: state.ageAttestedAt,
      termsVersion: CURRENT_TERMS_VERSION,
    };
  }

  return {
    termsAcceptedAt: acceptedAt,
    ageAttestedAt: acceptedAt,
    termsVersion: CURRENT_TERMS_VERSION,
  };
}
