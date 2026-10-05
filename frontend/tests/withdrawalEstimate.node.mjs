// Run: node --experimental-strip-types --test tests/withdrawalEstimate.node.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWithdrawalEstimate } from '../src/utils/withdrawalEstimate.ts';

test('uses the supplied rate only for an anchor-supported currency', () => {
  assert.deepEqual(getWithdrawalEstimate('25', ['NGN', 'KES'], 'NGN', 1500), {
    estimatedReceive: 37500, isCurrencySupported: true, error: null,
  });
  const unsupported = getWithdrawalEstimate('25', ['EUR', 'GBP'], 'NGN', 1500);
  assert.equal(unsupported.estimatedReceive, 0);
  assert.equal(unsupported.isCurrencySupported, false);
  assert.match(unsupported.error, /does not support NGN/);
});

test('does not quote before selecting an anchor, but reports an empty support list', () => {
  assert.deepEqual(getWithdrawalEstimate('25', undefined, 'NGN', 1500), {
    estimatedReceive: 0, isCurrencySupported: false, error: null,
  });
  assert.match(getWithdrawalEstimate('25', [], 'NGN', 1500).error, /does not support NGN/);
});

test('refreshes for currency and rate changes without editing the amount', () => {
  const currencies = ['NGN', 'KES'];
  assert.equal(getWithdrawalEstimate('25', currencies, 'NGN', 1500).estimatedReceive, 37500);
  assert.equal(getWithdrawalEstimate('25', currencies, 'NGN', 1600).estimatedReceive, 40000);
  assert.equal(getWithdrawalEstimate('25', currencies, 'KES', 130).estimatedReceive, 3250);
  assert.equal(getWithdrawalEstimate('25', currencies, 'EUR', 0.92).estimatedReceive, 0);
});

test('switching to a supported anchor removes the currency error', () => {
  assert.ok(getWithdrawalEstimate('10', ['NGN'], 'EUR', 0.92).error);
  assert.deepEqual(getWithdrawalEstimate('25', ['EUR'], 'EUR', 0.92), {
    estimatedReceive: 23, isCurrencySupported: true, error: null,
  });
});

test('empty, invalid, negative and non-finite amounts never produce an estimate', () => {
  for (const amount of ['', ' ', 'oops', '10oops', '-5', '0', 'Infinity', '1e309']) {
    assert.equal(getWithdrawalEstimate(amount, ['EUR'], 'EUR', 0.92).estimatedReceive, 0);
  }
});

test('invalid rates and arithmetic overflow never produce an estimate', () => {
  for (const rate of [NaN, Infinity, -Infinity, 0, -1]) {
    assert.equal(getWithdrawalEstimate('25', ['EUR'], 'EUR', rate).estimatedReceive, 0);
  }
  assert.equal(getWithdrawalEstimate('1e308', ['EUR'], 'EUR', 10).estimatedReceive, 0);
});
