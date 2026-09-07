export const BATON_RECEIPT_NAMES = {
  active: "BATON",
  complete: "BATON_COMPLETE",
  recovery: "BATON_RECOVERY",
} as const;

// Immutable public-Preprod plans created with rc.9 still need to be readable
// and actionable. New plans never use these legacy asset names.
export const LEGACY_RC9_RECEIPT_NAMES = {
  active: "LAST_SIGNAL",
  complete: "LAST_SIGNAL_DONE",
  recovery: "LAST_SIGNAL_RECOVERY",
} as const;

export const SUPPORTED_RECEIPT_NAMES = [
  BATON_RECEIPT_NAMES.active,
  LEGACY_RC9_RECEIPT_NAMES.active,
] as const;

export function receiptNamesFor(activeName: string) {
  if (activeName === BATON_RECEIPT_NAMES.active) return BATON_RECEIPT_NAMES;
  if (activeName === LEGACY_RC9_RECEIPT_NAMES.active) {
    return LEGACY_RC9_RECEIPT_NAMES;
  }
  return null;
}
