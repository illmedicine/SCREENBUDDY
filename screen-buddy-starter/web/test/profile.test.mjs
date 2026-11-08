import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, isValidName, safePhoto, defaultName, newProfile, initials, NAME_MAX } from '../js/profile.js';

test('cleanName trims, collapses spaces and drops control characters', () => {
  assert.equal(cleanName('  Ada   Lovelace \n'), 'Ada Lovelace');
  assert.equal(cleanName('a\u0000b\u0007c'), 'a b c');
  assert.equal(cleanName(null), '');
  assert.equal(cleanName(undefined), '');
});

test('isValidName accepts only clean names of 1 to 40 characters', () => {
  assert.ok(isValidName('Ada'));
  assert.ok(isValidName('x'.repeat(NAME_MAX)));
  assert.ok(!isValidName(''));
  assert.ok(!isValidName(' Ada'));
  assert.ok(!isValidName('Ada  L'));
  assert.ok(!isValidName('x'.repeat(NAME_MAX + 1)));
  assert.ok(!isValidName(42));
});

test('safePhoto keeps https URLs only', () => {
  assert.equal(safePhoto('https://lh3.googleusercontent.com/a/x'), 'https://lh3.googleusercontent.com/a/x');
  assert.equal(safePhoto('http://example.com/a.png'), '');
  assert.equal(safePhoto('javascript:alert(1)'), '');
  assert.equal(safePhoto('data:image/png;base64,AAAA'), '');
  assert.equal(safePhoto('https://x/' + 'a'.repeat(600)), '');
  assert.equal(safePhoto(undefined), '');
});

test('defaultName prefers the Google name, then the email name, then Friend', () => {
  assert.equal(defaultName({ displayName: 'Ada Lovelace', email: 'a@b.c' }), 'Ada Lovelace');
  assert.equal(defaultName({ displayName: '', email: 'ada.l@example.com' }), 'ada.l');
  assert.equal(defaultName({}), 'Friend');
  assert.equal(defaultName(null), 'Friend');
  assert.equal(defaultName({ displayName: 'x'.repeat(100) }).length, NAME_MAX);
});

test('newProfile produces a valid profile', () => {
  const p = newProfile({ displayName: '  Ada ', photoURL: 'http://insecure/x.png', email: 'a@b.c' });
  assert.deepEqual(p, { displayName: 'Ada', photoURL: '' });
  assert.ok(isValidName(p.displayName));
});

test('initials', () => {
  assert.equal(initials('Ada Lovelace'), 'AL');
  assert.equal(initials('ada'), 'A');
  assert.equal(initials('  '), '?');
  assert.equal(initials('Mary Jane Watson'), 'MW');
});
