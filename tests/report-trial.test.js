// Temporary: deliberate failure to verify the test report (#35). Reverted before review.
import assert from 'node:assert/strict';
import test from 'node:test';

test('report trial: deliberate failure', () => {
  assert.equal(1 + 1, 3);
});
