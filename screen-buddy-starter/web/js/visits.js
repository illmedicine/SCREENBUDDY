// Counts page views for the admin page: one small write to visits/{UTC date} per page load. "uniques" goes up once per
// browser per day (remembered in localStorage, so private windows count again). No cookies, nothing personal is stored.
import { cloud } from './cloud.js';

const day = new Date().toISOString().slice(0, 10);
let first = true;
try { first = localStorage.getItem('sb-visit-day') !== day; localStorage.setItem('sb-visit-day', day); } catch { /* storage blocked */ }

cloud().then(c => {
  if (!c) return;
  const { F, db } = c;
  return F.setDoc(F.doc(db, 'visits', day),
    { views: F.increment(1), uniques: F.increment(first ? 1 : 0), updatedAt: F.serverTimestamp() }, { merge: true });
}).catch(e => console.warn('Visit not counted', e));
