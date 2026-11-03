import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMessages, deliveryState, newClientMessageId } from '../src/utils/supportChatCore.js';

const at = (s) => new Date(Date.UTC(2026, 10, 3, 10, 0, s)).toISOString();

test('server copy replaces the optimistic message with the same clientMessageId', () => {
  const optimistic = { _id: 'tmp-c1', clientMessageId: 'c1', messageText: 'hi', createdAt: at(5), pending: true };
  const merged = mergeMessages([optimistic], [{ _id: 'm1', clientMessageId: 'c1', messageText: 'hi', createdAt: at(6) }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]._id, 'm1');
  assert.equal(merged[0].pending, false);
});

test('the same message arriving by REST and socket is kept once, in time order', () => {
  const a = { _id: 'a', createdAt: at(1) };
  const b = { _id: 'b', createdAt: at(2) };
  const merged = mergeMessages([b], [a, b, a]);
  assert.deepEqual(merged.map((m) => m._id), ['a', 'b']);
});

test('delivery state progression', () => {
  assert.equal(deliveryState({ pending: true }), 'sending');
  assert.equal(deliveryState({ failed: true }), 'failed');
  assert.equal(deliveryState({}), 'sent');
  assert.equal(deliveryState({ deliveredAt: at(1) }), 'delivered');
  assert.equal(deliveryState({ deliveredAt: at(1), readAt: at(2) }), 'read');
});

test('client message ids match the server format', () => {
  const id = newClientMessageId();
  assert.match(id, /^[\w-]{6,64}$/);
  assert.notEqual(id, newClientMessageId());
});
