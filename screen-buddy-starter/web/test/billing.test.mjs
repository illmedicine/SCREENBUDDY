import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOG, Wallet, addMonths, periodIndex } from '../js/billing.js';

const shared = name => JSON.parse(readFileSync(new URL(`../../billing/${name}`, import.meta.url), 'utf8'));
const t = iso => Date.parse(iso);

test('the built-in catalog is billing/catalog.json', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CATALOG)), shared('catalog.json'));
});

test('addMonths keeps the day, or the last day of a shorter month', () => {
  assert.equal(new Date(addMonths(t('2026-01-31T12:00:00Z'), 1)).toISOString(), '2026-02-28T12:00:00.000Z');
  assert.equal(new Date(addMonths(t('2026-01-31T12:00:00Z'), 2)).toISOString(), '2026-03-31T12:00:00.000Z');
  assert.equal(new Date(addMonths(t('2027-12-15T00:00:00Z'), 2)).toISOString(), '2028-02-15T00:00:00.000Z');
  assert.equal(new Date(addMonths(t('2028-01-30T00:00:00Z'), 1)).toISOString(), '2028-02-29T00:00:00.000Z');
});

test('periodIndex counts whole months from the anchor', () => {
  const a = t('2026-01-31T12:00:00Z');
  assert.equal(periodIndex(a, a), 0);
  assert.equal(periodIndex(a, t('2026-02-28T11:59:59Z')), 0);
  assert.equal(periodIndex(a, t('2026-02-28T12:00:00Z')), 1);
  assert.equal(periodIndex(a, t('2026-03-31T12:00:00Z')), 2);
  assert.equal(periodIndex(a, t('2025-12-01T00:00:00Z')), 0);
});

for (const sc of shared('scenarios.json').scenarios) {
  test(`scenario: ${sc.name}`, () => {
    const w = new Wallet();
    sc.steps.forEach((s, i) => {
      const where = `step ${i + 1} (${s.op} ${s.id ?? ''})`;
      if (s.op === 'balance') {
        const b = w.balance(t(s.at));
        const flat = {
          freeLeft: b.freeLeft, credits: b.credits,
          subActive: b.subscription?.active ?? false, subLeft: b.subscription?.left ?? 0,
          paidThrough: b.subscription ? new Date(b.subscription.paidThrough).toISOString().replace('.000Z', 'Z') : null,
          autoRenew: b.subscription?.autoRenew ?? null,
        };
        for (const [k, v] of Object.entries(s.expect)) assert.equal(flat[k], v, `${where}: ${k}`);
        return;
      }
      const r = {
        pay: () => w.applyPayment({ id: s.id, productId: s.product, amountCents: s.amountCents, currency: s.currency, status: s.status, at: t(s.at) }),
        create: () => w.startCreation(s.id, t(s.at)),
        reprocess: () => w.reprocess(s.id),
        refundCreation: () => w.refundCreation(s.id, t(s.at)),
        refundPayment: () => w.refundPayment(s.id),
        cancel: () => w.cancelSubscription(),
      }[s.op]();
      assert.equal(r.code, s.expect, where);
      if (s.source) assert.equal(r.source, s.source, `${where}: source`);
      // Saving and loading at every step must not change anything.
      const copy = new Wallet(JSON.parse(JSON.stringify(w)));
      assert.deepEqual(copy.toJSON(), w.toJSON(), `${where}: round trip`);
    });
  });
}

test('a damaged saved wallet loads as a clean one instead of failing', () => {
  for (const bad of [null, 'x', 42, { credits: -5, freeUsed: 'a', sub: { productId: 1 }, payments: { p: null }, creations: { c: { source: 'stolen' } } }]) {
    const w = new Wallet(bad);
    assert.deepEqual(w.toJSON(), { freeUsed: 0, credits: 0, sub: null, payments: {}, creations: {} });
  }
});

test('bad input is refused, not thrown', () => {
  const w = new Wallet();
  assert.equal(w.applyPayment(null).code, 'invalid_receipt');
  assert.equal(w.applyPayment({ id: '', productId: 'single' }).code, 'invalid_receipt');
  assert.equal(w.applyPayment({ id: 'p', productId: 'single', amountCents: 99, currency: 'USD', status: 'COMPLETED', at: NaN }).code, 'invalid_receipt');
  assert.equal(w.startCreation('', 0).code, 'invalid_id');
});
