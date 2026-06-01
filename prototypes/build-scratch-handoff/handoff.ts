// PROTOTYPE — throwaway. Portable types + fixtures (no I/O).
//
// The redacted handoff payload: what browser-use passes AFTER Gate 1.
// browser-use drove live, hit friction, observed the flow. At the handoff
// boundary it redacts (Gate 1: "return shape only" — SKILL.md:113). What
// crosses the skill boundary is observations, never typed values.

/** One observed field in the flow, in the order it was encountered. */
export interface ObservedField {
  /** The field's name/label as seen in the DOM (e.g. "username", "password"). */
  name: string;
  /**
   * What browser-use observed about the value — SHAPE not value.
   * "good" handoffs carry redacted placeholders; a "leaky" fixture carries a
   * raw typed value to prove Gate 2 fail-closes.
   */
  observed: string;
}

/** A fork the flow could have taken; records which branch was actually used. */
export interface ForkObservation {
  label: string;
  taken: string;
}

/** Pointer to where auth lives — a reference, never the credential itself. */
export interface AuthPointer {
  /** e.g. "1password:Molty/Acme Login" — a reference, resolved at replay time. */
  reference: string;
  /** Where in the flow auth was required (field name or step label). */
  locatedAt: string;
}

/** The full redacted summary browser-use hands to build-scratch. */
export interface RedactedHandoff {
  domain: string;
  flowSlug: string;
  fields: ObservedField[];
  forks: ForkObservation[];
  auth: AuthPointer;
  /** Redacted description of where the live driver got stuck, if any. */
  stuckPoint: string | null;
}

// --- Fixtures the TUI drives -------------------------------------------------

/** Clean handoff: Gate 1 already replaced the typed password with a placeholder. */
export const CLEAN_LOGIN: RedactedHandoff = {
  domain: "acme.example.com",
  flowSlug: "login",
  fields: [
    { name: "username", observed: "free-text, ~12 chars" },
    { name: "password", observed: "redacted:password-field" },
  ],
  forks: [{ label: "mfa-prompt", taken: "skipped (remembered device)" }],
  auth: {
    reference: "1password:Molty/Acme Login",
    locatedAt: "password",
  },
  stuckPoint: null,
};

/** Clean handoff with a mid-flow stuck point, still fully redacted. */
export const CLEAN_CHECKOUT: RedactedHandoff = {
  domain: "shop.example.com",
  flowSlug: "checkout",
  fields: [
    { name: "email", observed: "free-text, email shape" },
    { name: "card_number", observed: "redacted:card-field" },
    { name: "promo_code", observed: "free-text, ~8 chars" },
  ],
  forks: [{ label: "guest-vs-account", taken: "guest" }],
  auth: {
    reference: "none (guest checkout)",
    locatedAt: "n/a",
  },
  stuckPoint: "redacted:address-autocomplete dropdown did not settle; retried",
};

/**
 * LEAKY handoff: Gate 1 FAILED — a raw typed secret slipped across the
 * boundary. Two distinct leaks to exercise both Gate 2 detectors:
 *  - a deny-listed FIELD NAME ("api_token") carrying a real value-shape, and
 *  - a clean-named field whose VALUE matches a deny-list value pattern (OTP).
 * Gate 2 must fail-close the WHOLE batch and name the offending entry.
 */
export const LEAKY_LOGIN: RedactedHandoff = {
  domain: "leaky.example.com",
  flowSlug: "login",
  fields: [
    { name: "username", observed: "free-text, ~12 chars" },
    { name: "password", observed: "hunter2" }, // raw value — should never appear
    { name: "verification", observed: "482913" }, // OTP value under a clean name
    { name: "api_token", observed: "sk-live-9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c" },
  ],
  forks: [],
  auth: { reference: "1password:Molty/Leaky", locatedAt: "password" },
  stuckPoint: null,
};

export const FIXTURES: Record<string, RedactedHandoff> = {
  "clean-login": CLEAN_LOGIN,
  "clean-checkout": CLEAN_CHECKOUT,
  "leaky-login": LEAKY_LOGIN,
};
