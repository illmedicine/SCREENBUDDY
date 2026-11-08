// The signed-in person's wallet in Firestore (users/{uid}/wallet/main), so their balance follows them to every
// device. The same billing.js engine decides; every change is a transaction, and /firestore.rules re-checks it:
// a new character must spend exactly one buddy, and credits can only be added by a payment.
//
// Trust: until PayPal is verified on the server, the browser applies receipts itself, so the rules only accept
// client payments while config/site.clientReceipts is on (the admin's test-payment switch, off by default). With real
// PayPal, server code (Admin SDK) checks the order with PayPal and writes the payment into this same document.
import { Wallet } from './billing.js';

export function walletStore(c, uid) {
  const { F, db } = c;
  const ref = F.doc(db, 'users', uid, 'wallet', 'main');
  const asDoc = (w, lastPayment) => ({ ...w.toJSON(), ...(lastPayment ? { lastPayment } : {}), updatedAt: F.serverTimestamp() });
  const read = async tx => { const s = await tx.get(ref); return new Wallet(s.exists() ? s.data() : {}); };

  return {
    /** Calls fn(wallet) now and whenever it changes (on any device). Returns the unsubscribe function. */
    watch(fn, onError) {
      return F.onSnapshot(ref, s => fn(new Wallet(s.exists() ? s.data() : {})), onError);
    },

    /** Adds a payment the provider confirmed. Resolves to the engine's Result. */
    pay(receipt) {
      return F.runTransaction(db, async tx => {
        const w = await read(tx);
        const r = w.applyPayment(receipt);
        if (r.ok && r.code !== 'already_applied') tx.set(ref, asDoc(w, receipt.id));
        return r;
      });
    },

    cancelRenewal() {
      return F.runTransaction(db, async tx => {
        const w = await read(tx);
        const r = w.cancelSubscription();
        if (r.ok) tx.set(ref, asDoc(w));
        return r;
      });
    },

    /** Spends one buddy and creates the character in one write. Resolves to the engine's Result ('no_credits' when nothing is left). */
    createCharacter(cid, fields) {
      const charRef = F.doc(db, 'users', uid, 'characters', cid);
      return F.runTransaction(db, async tx => {
        const w = await read(tx);
        const r = w.startCreation(cid, Date.now());
        if (!r.ok) return r;
        tx.set(ref, asDoc(w));
        tx.set(charRef, { ...fields, createdAt: F.serverTimestamp(), updatedAt: F.serverTimestamp() });
        return r;
      });
    },
  };
}
