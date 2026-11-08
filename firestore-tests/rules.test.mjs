// /firestore.rules against the Firestore emulator. Run from this folder: npm install, then npm test
// (needs Java and the Firebase CLI; `firebase emulators:exec` starts and stops the emulator).
import test, { before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, collection, collectionGroup, serverTimestamp, increment,
} from 'firebase/firestore';
import { Wallet } from '../screen-buddy-starter/web/js/billing.js';

const ADMIN = { email: 'demarkuswilsone@gmail.com', email_verified: true };
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-screenbuddy',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env?.cleanup());
beforeEach(() => env.clearFirestore());

const as = (uid, claims = {}) => env.authenticatedContext(uid, claims).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const admin = () => as('owner', ADMIN);

const character = (extra = {}) => ({
  name: 'Dance Queen', videoUrl: 'https://www.tiktok.com/@kiah/video/1', platform: 'TikTok', creatorName: 'Kiah',
  creatorLink: 'https://www.tiktok.com/@kiah', status: 'queued', runs: 1, disabled: false,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
});

async function walletOf(db, uid) {
  const s = await getDoc(doc(db, 'users', uid, 'wallet', 'main'));
  return { w: new Wallet(s.exists() ? s.data() : {}), raw: s.exists() ? s.data() : null };
}
const walletDoc = (w, extra = {}) => ({ ...w.toJSON(), updatedAt: serverTimestamp(), ...extra });

/** What the dashboard does: spend one buddy with the engine and create the character in the same write. */
async function make(db, uid, cid, fields = {}) {
  const { w } = await walletOf(db, uid);
  w.startCreation(cid, Date.now());
  const b = writeBatch(db);
  b.set(doc(db, 'users', uid, 'wallet', 'main'), walletDoc(w));
  b.set(doc(db, 'users', uid, 'characters', cid), character(fields));
  return b.commit();
}

async function pay(db, uid, productId, id = `dev-${productId}-${Math.random().toString(36).slice(2)}`) {
  const { w } = await walletOf(db, uid);
  const p = w.product(productId);
  w.applyPayment({ id, productId, amountCents: p.priceCents, currency: 'USD', status: 'COMPLETED', at: Date.now() });
  return setDoc(doc(db, 'users', uid, 'wallet', 'main'), walletDoc(w, { lastPayment: id }));
}

const testPayments = on => env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'config', 'site'), { clientReceipts: on }));

// ---- the free character and paying for more ------------------------------------------------------------------------

test('the first character is free, the second needs a credit', async () => {
  const alice = as('alice');
  await assertSucceeds(make(alice, 'alice', 'charOne1'));
  await assertFails(make(alice, 'alice', 'charTwo2'));
});

test('a character cannot be created without spending from the wallet', async () => {
  const alice = as('alice');
  await assertFails(setDoc(doc(alice, 'users', 'alice', 'characters', 'charOne1'), character()));
});

test('the free buddy cannot be reset and credits cannot be invented', async () => {
  const alice = as('alice');
  await assertSucceeds(make(alice, 'alice', 'charOne1'));
  const { w } = await walletOf(alice, 'alice');
  await assertFails(setDoc(doc(alice, 'users', 'alice', 'wallet', 'main'), walletDoc(new Wallet({ ...w.toJSON(), freeUsed: 0 }))));
  await assertFails(setDoc(doc(alice, 'users', 'alice', 'wallet', 'main'), walletDoc(new Wallet({ ...w.toJSON(), credits: 5 }))));
});

test('client payments are refused unless test payments are switched on', async () => {
  const alice = as('alice');
  await assertFails(pay(alice, 'alice', 'pack5'));
  await testPayments(true);
  await assertSucceeds(pay(alice, 'alice', 'pack5'));
  const { w } = await walletOf(alice, 'alice');
  if (w.credits !== 5) throw new Error(`expected 5 credits, got ${w.credits}`);
});

test('a payment must add exactly what the product buys', async () => {
  await testPayments(true);
  const alice = as('alice');
  const w = new Wallet();
  w.applyPayment({ id: 'p1', productId: 'single', amountCents: 99, currency: 'USD', status: 'COMPLETED', at: Date.now() });
  const forged = { ...w.toJSON(), credits: 50 };
  await assertFails(setDoc(doc(alice, 'users', 'alice', 'wallet', 'main'), { ...forged, lastPayment: 'p1', updatedAt: serverTimestamp() }));
});

test('after buying, credits pay for more characters', async () => {
  await testPayments(true);
  const alice = as('alice');
  await assertSucceeds(make(alice, 'alice', 'charOne1'));
  await assertSucceeds(pay(alice, 'alice', 'single'));
  await assertSucceeds(make(alice, 'alice', 'charTwo2'));
  await assertFails(make(alice, 'alice', 'charThree3'));
});

test('the Creator plan pays for characters this month', async () => {
  await testPayments(true);
  const alice = as('alice');
  await assertSucceeds(pay(alice, 'alice', 'creator_monthly'));
  await assertSucceeds(make(alice, 'alice', 'charOne1'));     // plan first
  await assertSucceeds(make(alice, 'alice', 'charTwo2'));
  const { w } = await walletOf(alice, 'alice');
  if (w.balance(Date.now()).subscription.left !== 8 || w.freeUsed !== 0) throw new Error('plan allowance not spent');
});

test('a deleted character id cannot be recreated for free', async () => {
  const alice = as('alice');
  await assertSucceeds(make(alice, 'alice', 'charOne1'));
  await assertSucceeds(deleteDoc(doc(alice, 'users', 'alice', 'characters', 'charOne1')));
  await assertFails(setDoc(doc(alice, 'users', 'alice', 'characters', 'charOne1'), character()));
});

// ---- ownership and editing ------------------------------------------------------------------------------------------

test('characters are private to their owner (and the admin)', async () => {
  await assertSucceeds(make(as('alice'), 'alice', 'charOne1'));
  await assertSucceeds(getDoc(doc(as('alice'), 'users', 'alice', 'characters', 'charOne1')));
  await assertFails(getDoc(doc(as('bob'), 'users', 'alice', 'characters', 'charOne1')));
  await assertFails(getDoc(doc(anon(), 'users', 'alice', 'characters', 'charOne1')));
  await assertFails(getDocs(collectionGroup(as('bob'), 'characters')));
  await assertSucceeds(getDocs(collectionGroup(admin(), 'characters')));
  await assertFails(make(as('bob'), 'alice', 'charBob01'));
});

test('the video can never be replaced; name and creator link can be edited', async () => {
  const alice = as('alice');
  await assertSucceeds(make(alice, 'alice', 'charOne1'));
  const ref = doc(alice, 'users', 'alice', 'characters', 'charOne1');
  await assertFails(updateDoc(ref, { videoUrl: 'https://youtu.be/other', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { name: 'New Name', creatorLink: 'https://instagram.com/kiah', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { disabled: false, status: 'ready', updatedAt: serverTimestamp() }));
});

test('three free re-dos, only after it is ready or failed', async () => {
  const alice = as('alice');
  await assertSucceeds(make(alice, 'alice', 'charOne1'));
  const ref = doc(alice, 'users', 'alice', 'characters', 'charOne1');
  const redo = runs => updateDoc(ref, { status: 'queued', runs, updatedAt: serverTimestamp() });
  await assertFails(redo(2));                                  // still queued
  const finish = () => env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), 'users', 'alice', 'characters', 'charOne1'), { status: 'ready' }));
  for (const runs of [2, 3, 4]) { await finish(); await assertSucceeds(redo(runs)); }
  await finish();
  await assertFails(redo(5));
});

test('profiles: own only, and the chosen buddy can be saved', async () => {
  const alice = as('alice');
  await assertSucceeds(setDoc(doc(alice, 'users', 'alice'), { displayName: 'Alice', photoURL: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(alice, 'users', 'alice'), { buddyId: 'kiah', updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(as('bob'), 'users', 'alice')));
});

test('favorites belong to their owner', async () => {
  const ref = db => doc(db, 'users', 'alice', 'favorites', 'tiktok-com-kiah');
  const fav = { name: 'Kiah', link: 'https://www.tiktok.com/@kiah', createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(ref(as('alice')), fav));
  await assertFails(setDoc(ref(as('bob')), fav));
  await assertFails(getDoc(ref(as('bob'))));
  await assertFails(setDoc(ref(as('alice')), { ...fav, link: 'javascript:alert(1)' }));
});

// ---- admin ------------------------------------------------------------------------------------------------------------

test('only the admin account changes the collection and site settings', async () => {
  const site = { featured: 'kiah', clientReceipts: false, updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(admin(), 'config', 'site'), site));
  await assertFails(setDoc(doc(as('alice'), 'config', 'site'), site));
  await assertFails(setDoc(doc(as('fake', { email: ADMIN.email, email_verified: false }), 'config', 'site'), site));
  await assertSucceeds(getDoc(doc(anon(), 'config', 'site')));

  const buddy = { name: 'Puppy Love', creatorName: 'Kiah', creatorLink: 'https://www.tiktok.com/@kiah', hidden: true, updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(admin(), 'buddies', 'kiah'), buddy));
  await assertFails(setDoc(doc(as('alice'), 'buddies', 'kiah'), buddy));
  await assertSucceeds(getDoc(doc(anon(), 'buddies', 'kiah')));
});

test('the admin can switch off anyone\'s character; the owner cannot switch it back on', async () => {
  await assertSucceeds(make(as('alice'), 'alice', 'charOne1'));
  await assertSucceeds(updateDoc(doc(admin(), 'users', 'alice', 'characters', 'charOne1'), { disabled: true, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(as('alice'), 'users', 'alice', 'characters', 'charOne1'), { disabled: false, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(admin(), 'users', 'alice', 'characters', 'charOne1'), { videoUrl: 'https://youtu.be/x', updatedAt: serverTimestamp() }));
});

// ---- stats ------------------------------------------------------------------------------------------------------------

test('stats: small increments from anyone, readable only by the admin', async () => {
  const add = (db, key, selections, seconds) => setDoc(doc(db, 'stats', key),
    { selections: increment(selections), seconds: increment(seconds), updatedAt: serverTimestamp() }, { merge: true });
  await assertSucceeds(add(anon(), 'kiah', 1, 60));
  await assertSucceeds(add(as('alice'), 'kiah', 0, 900));
  await assertFails(add(anon(), 'kiah', 0, 901));
  await assertFails(add(anon(), 'kiah', 11, 0));
  await assertFails(add(anon(), 'kiah', -1, 0));
  await assertSucceeds(add(as('alice'), 'alice__charOne1', 1, 5));
  await assertFails(add(as('bob'), 'alice__charOne1', 1, 5));
  await assertFails(getDoc(doc(as('alice'), 'stats', 'kiah')));
  await assertSucceeds(getDocs(collection(admin(), 'stats')));
});

// ---- visits, admin jobs, cloud catalog -------------------------------------------------------------------------------

test('visits: one view per write from anyone, readable only by the admin', async () => {
  const visit = (db, day, unique) => setDoc(doc(db, 'visits', day),
    { views: increment(1), uniques: increment(unique ? 1 : 0), updatedAt: serverTimestamp() }, { merge: true });
  await assertSucceeds(visit(anon(), '2026-11-08', true));
  await assertSucceeds(visit(as('alice'), '2026-11-08', false));
  await assertFails(setDoc(doc(anon(), 'visits', '2026-11-08'), { views: increment(5), uniques: increment(0), updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(anon(), 'visits', '2026-11-08'), { views: increment(1), uniques: increment(2), updatedAt: serverTimestamp() }, { merge: true }));
  await assertFails(visit(anon(), 'yesterday', true));
  await assertFails(getDoc(doc(anon(), 'visits', '2026-11-08')));
  await assertSucceeds(getDocs(collection(admin(), 'visits')));
});

test('jobs: only the admin adds a buddy job; catalog is public to read, worker-only to write', async () => {
  const job = { name: 'New Buddy', creatorName: 'Someone', creatorLink: 'https://www.tiktok.com/@someone',
    videoUrl: 'https://www.tiktok.com/@someone/video/123', people: 2, quality: false, status: 'queued', createdAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(admin(), 'jobs', 'jobOne01'), job));
  await assertFails(setDoc(doc(as('alice'), 'jobs', 'jobTwo02'), job));
  await assertFails(setDoc(doc(admin(), 'jobs', 'jobThree'), { ...job, status: 'ready' }));
  await assertFails(setDoc(doc(admin(), 'jobs', 'jobFour4'), { ...job, people: 9 }));
  const { videoUrl, ...uploaded } = job;
  await assertSucceeds(setDoc(doc(admin(), 'jobs', 'jobFive5'), { ...uploaded, storagePath: 'uploads/admin/jobFive5/video.mp4' }));
  await assertFails(setDoc(doc(admin(), 'jobs', 'jobSix66'), { ...uploaded, storagePath: 'uploads/admin/other/video.mp4' }));
  await assertFails(getDoc(doc(as('alice'), 'jobs', 'jobOne01')));
  await assertSucceeds(getDoc(doc(anon(), 'catalog', 'any-buddy')));
  await assertFails(setDoc(doc(admin(), 'catalog', 'any-buddy'), { name: 'x' }));
});
