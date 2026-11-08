// Profile rules shared by the page and the tests. Pure logic, no browser or Firebase APIs.
// The Firestore rules in /firestore.rules enforce the same limits on the server: keep them in step.

export const NAME_MAX = 40;
export const PHOTO_MAX = 500;

/** A display name as the user typed it: trimmed, inner whitespace collapsed, control characters removed. */
export function cleanName(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isValidName(name) {
  return typeof name === 'string' && name.length >= 1 && name.length <= NAME_MAX && name === cleanName(name);
}

/** Only https pictures are kept (Google's avatar URLs). Anything else becomes '' so no odd URL is ever stored or shown. */
export function safePhoto(url) {
  return typeof url === 'string' && url.length <= PHOTO_MAX && /^https:\/\//i.test(url) ? url : '';
}

/** The name to start a new profile with: Google's name, else the part of the email before the @, else "Friend". */
export function defaultName(user) {
  const fromGoogle = cleanName(user?.displayName).slice(0, NAME_MAX).trim();
  if (fromGoogle) return fromGoogle;
  const fromEmail = cleanName(String(user?.email ?? '').split('@')[0]).slice(0, NAME_MAX).trim();
  return fromEmail || 'Friend';
}

/** The fields written when a profile is first created (the page adds the server timestamps). */
export function newProfile(user) {
  return { displayName: defaultName(user), photoURL: safePhoto(user?.photoURL) };
}

/** Initials for the round avatar when there is no picture. */
export function initials(name) {
  const parts = cleanName(name).split(' ').filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
