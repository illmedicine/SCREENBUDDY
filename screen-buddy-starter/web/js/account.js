// Sign in with Google, and the person's profile. Adds a button (signed out) or an avatar menu (signed in) to the
// page header. Does nothing if js/firebase-config.js has no project. The profile lives in Firestore at users/{uid};
// /firestore.rules decides what a signed-in person may read and write there.
import { firebaseConfig } from './firebase-config.js';
import { cleanName, isValidName, newProfile, safePhoto, initials, NAME_MAX } from './profile.js';

const SDK = 'https://www.gstatic.com/firebasejs/11.0.2';
const host = document.getElementById('account');

if (host && firebaseConfig?.apiKey) start().catch(e => console.warn('Account: could not start', e));

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);

  let user = null, profile = null, message = '';

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids);
    return n;
  };

  function publish() {
    window.dispatchEvent(new CustomEvent('sb-auth', { detail: { uid: user?.uid ?? null, email: user?.email ?? null, profile } }));
  }

  // ---- profile ---------------------------------------------------------------------------------------------
  async function loadProfile(u) {
    const ref = F.doc(db, 'users', u.uid);
    const snap = await F.getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      return { displayName: String(d.displayName ?? ''), photoURL: safePhoto(d.photoURL) };
    }
    const fresh = newProfile(u);
    await F.setDoc(ref, { ...fresh, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
    return fresh;
  }

  async function saveName(raw) {
    const name = cleanName(raw);
    if (!isValidName(name)) { message = `Use 1 to ${NAME_MAX} characters.`; render(); return; }
    try {
      await F.updateDoc(F.doc(db, 'users', user.uid), { displayName: name, updatedAt: F.serverTimestamp() });
      profile = { ...profile, displayName: name };
      message = 'Saved.';
      publish();
    } catch (e) {
      console.warn('Account: save failed', e);
      message = 'Could not save. Try again.';
    }
    render();
  }

  // ---- sign in / out ---------------------------------------------------------------------------------------
  async function signIn() {
    message = '';
    const provider = new A.GoogleAuthProvider();
    try {
      await A.signInWithPopup(auth, provider);
    } catch (e) {
      switch (e?.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request':
          return;
        case 'auth/popup-blocked':
          try { await A.signInWithRedirect(auth, provider); return; } catch { message = 'Your browser blocked the sign-in window.'; }
          break;
        case 'auth/operation-not-allowed':
          message = 'Google sign-in is not switched on for this app yet.';
          break;
        case 'auth/unauthorized-domain':
          message = 'Sign-in is not set up for this web address yet.';
          break;
        case 'auth/network-request-failed':
          message = 'No connection. Check your internet and try again.';
          break;
        default:
          console.warn('Account: sign-in failed', e);
          message = 'Could not sign in. Try again.';
      }
      render();
    }
  }

  async function signOut() {
    await A.signOut(auth);
  }

  // ---- drawing ---------------------------------------------------------------------------------------------
  function avatar(size) {
    const url = safePhoto(profile?.photoURL);
    const box = el('span', { className: 'acct-avatar' });
    box.style.setProperty('--s', `${size}px`);
    if (url) box.append(el('img', { src: url, alt: '', referrerPolicy: 'no-referrer', width: size, height: size }));
    else box.append(initials(profile?.displayName ?? ''));
    return box;
  }

  function render() {
    host.replaceChildren();
    host.hidden = false;
    if (!user) {
      host.append(el('button', { type: 'button', className: 'btn small acct-in', onclick: signIn }, 'Sign in with Google'));
      if (message) host.append(el('p', { className: 'acct-msg', role: 'alert' }, message));
      return;
    }
    const input = el('input', { id: 'acct-name', type: 'text', maxLength: NAME_MAX, value: profile?.displayName ?? '', autocomplete: 'nickname' });
    const form = el('form', { className: 'acct-form', onsubmit: ev => { ev.preventDefault(); saveName(input.value); } },
      el('label', { htmlFor: 'acct-name' }, 'Your name'),
      input,
      el('button', { type: 'submit', className: 'btn small' }, 'Save'));
    const menu = el('details', { className: 'acct-menu' },
      el('summary', { 'aria-label': `Account: ${profile?.displayName ?? ''}` }, avatar(34)),
      el('div', { className: 'acct-pop' },
        el('p', { className: 'acct-who' }, el('b', {}, profile?.displayName ?? ''), el('br'), el('span', {}, user.email ?? '')),
        form,
        message ? el('p', { className: 'acct-msg', role: 'status' }, message) : '',
        el('button', { type: 'button', className: 'btn small ghost', onclick: signOut }, 'Sign out')));
    menu.open = Boolean(message);
    host.append(menu);
  }

  A.onAuthStateChanged(auth, async u => {
    user = u;
    profile = null;
    message = '';
    if (u) {
      try { profile = await loadProfile(u); }
      catch (e) {
        console.warn('Account: could not load the profile', e);
        profile = newProfile(u);
        message = 'Signed in, but your profile could not be loaded yet.';
      }
    }
    render();
    publish();
  });

  render();
}
