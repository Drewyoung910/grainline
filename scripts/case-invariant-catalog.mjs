// Case-family trigger functions are owner-internal invariants, not application
// RPCs. Keep their catalog independent of the production postflight so every
// grant auditor and proof harness can consume the same authority boundary.
export const CASE_INVARIANT_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: "grainline_case_relationship_valid",
    securityDefiner: true,
  }),
  Object.freeze({
    name: "grainline_case_authority_fields_immutable",
    securityDefiner: false,
  }),
  Object.freeze({
    name: "grainline_case_status_transition_valid",
    securityDefiner: false,
  }),
  Object.freeze({
    name: "grainline_case_message_author_valid",
    securityDefiner: true,
  }),
  Object.freeze({
    name: "grainline_case_message_authority_fields_immutable",
    securityDefiner: false,
  }),
  Object.freeze({
    name: "grainline_case_message_maintain_thread",
    securityDefiner: true,
  }),
  Object.freeze({
    name: "grainline_case_opening_evidence_valid",
    securityDefiner: true,
  }),
  Object.freeze({
    name: "grainline_case_attachment_parent_valid",
    securityDefiner: true,
  }),
]);

export const CASE_INVARIANT_PRIVATE_FUNCTION_NAMES = Object.freeze(
  CASE_INVARIANT_FUNCTIONS.map((entry) => entry.name),
);
