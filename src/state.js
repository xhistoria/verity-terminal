const TRANSITIONS = Object.freeze({
  draft: { QUOTE_RECEIVED: 'quoted', SIMULATION_FAILED: 'simulation_failed' },
  quoted: { SIGN_REQUESTED: 'awaiting_signature', QUOTE_EXPIRED: 'quote_expired' },
  quote_expired: { QUOTE_RECEIVED: 'quoted' },
  simulation_failed: { QUOTE_RECEIVED: 'quoted' },
  awaiting_signature: { HASH_RECEIVED: 'pending', SIGNATURE_REJECTED: 'signature_rejected' },
  signature_rejected: { QUOTE_RECEIVED: 'quoted' },
  pending: {
    RECEIPT_SUCCESS: 'confirmed',
    RECEIPT_REVERTED: 'reverted',
    TRANSACTION_REPLACED: 'replaced',
    STATUS_UNKNOWN: 'unknown',
  },
  confirmed: { REORG_DETECTED: 'reorged' },
  reverted: { QUOTE_RECEIVED: 'quoted' },
  replaced: { RECEIPT_SUCCESS: 'confirmed', RECEIPT_REVERTED: 'reverted' },
  reorged: { RECEIPT_SUCCESS: 'confirmed', STATUS_UNKNOWN: 'unknown' },
  unknown: { RECEIPT_SUCCESS: 'confirmed', RECEIPT_REVERTED: 'reverted' },
});

export function transition(current, event) {
  const next = TRANSITIONS[current]?.[event];
  if (!next) throw new Error(`invalid_transition:${current}:${event}`);
  return next;
}

export const TRANSACTION_STATES = Object.freeze(Object.keys(TRANSITIONS));
