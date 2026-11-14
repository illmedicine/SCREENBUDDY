import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenIds } from '../js/collection.js';

test('hiddenIds lists exactly the buddies the admin hid', () => {
  const ids = hiddenIds({
    body: { hidden: true, name: 'Body' },
    claw: { hidden: true },
    kiah: { hidden: false },
    nadi: { name: 'Polka Dot' },
    odd: { hidden: 'true' },          // only a real true hides
    none: null,
  });
  assert.deepEqual([...ids].sort(), ['body', 'claw']);
});

test('hiddenIds copes with no settings', () => {
  assert.equal(hiddenIds(undefined).size, 0);
  assert.equal(hiddenIds({}).size, 0);
});
