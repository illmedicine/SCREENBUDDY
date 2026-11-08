// Loads Firebase once for the whole page and shares it. Resolves to null when js/firebase-config.js has no project
// or the SDK can't be reached, so every caller can fall back to working without an account.
import { firebaseConfig } from './firebase-config.js';
import { isAdminEmail } from './library.js';

const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';
let ready;

/** @returns {Promise<null | {app: any, auth: any, db: any, A: any, F: any}>} */
export function cloud() {
  if (!firebaseConfig?.apiKey) return Promise.resolve(null);
  ready ??= Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
  ]).then(([{ initializeApp }, A, F]) => {
    const app = initializeApp(firebaseConfig);
    return { app, A, F, auth: A.getAuth(app), db: F.getFirestore(app) };
  }).catch(e => { console.warn('Firebase could not start', e); return null; });
  return ready;
}

/** Calls fn(user|null) now and on every sign-in or sign-out. Returns a function that stops listening. */
export async function onUser(fn) {
  const c = await cloud();
  if (!c) { fn(null); return () => {}; }
  return c.A.onAuthStateChanged(c.auth, fn);
}

/** Opens Google sign-in (handled by js/account.js). After signing in, the page goes to `next` if given. */
export function askSignIn(next) {
  window.dispatchEvent(new CustomEvent('sb-signin', { detail: { next } }));
}

export const isAdmin = user => Boolean(user) && isAdminEmail(user.email, user.emailVerified);

/** A Firestore value as plain text for the page (never HTML). */
export const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
