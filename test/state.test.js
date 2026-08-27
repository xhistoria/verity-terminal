import test from 'node:test';
import assert from 'node:assert/strict';
import { transition } from '../src/state.js';

test('permits the verified execution lifecycle', () => {
  let state = 'draft';
  for (const event of ['QUOTE_RECEIVED', 'SIGN_REQUESTED', 'HASH_RECEIVED', 'RECEIPT_SUCCESS']) {
    state = transition(state, event);
  }
  assert.equal(state, 'confirmed');
});

test('preserves explicit failure and replacement states', () => {
  assert.equal(transition('quoted', 'QUOTE_EXPIRED'), 'quote_expired');
  assert.equal(transition('awaiting_signature', 'SIGNATURE_REJECTED'), 'signature_rejected');
  assert.equal(transition('pending', 'RECEIPT_REVERTED'), 'reverted');
  assert.equal(transition('pending', 'TRANSACTION_REPLACED'), 'replaced');
  assert.equal(transition('confirmed', 'REORG_DETECTED'), 'reorged');
});

test('rejects impossible lifecycle jumps', () => {
  assert.throws(() => transition('draft', 'HASH_RECEIVED'), /invalid_transition/);
  assert.throws(() => transition('confirmed', 'SIGN_REQUESTED'), /invalid_transition/);
});
