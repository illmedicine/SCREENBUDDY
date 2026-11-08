// The pricing model and the wallet engine: what a user can buy, what they have left, and what making a buddy costs.
// Pure logic with no browser APIs, so the same file can run on the server (Node) once sign-in arrives.
// Mirrors android/.../billing/Wallet.kt and windows/src/ScreenBuddy.Core/Billing/Wallet.cs; all three replay
// billing/scenarios.json in their tests and must agree. The catalog must equal billing/catalog.json.

/** @typedef {{id: string, kind: 'credits'|'subscription', title: string, blurb: string, credits: number, priceCents: number}} Product */
/** @typedef {{id: string, productId: string, amountCents: number, currency: string, status: string, at: number}} Receipt */
/** @typedef {{ok: boolean, code: string, source?: 'free'|'credit'|'subscription'}} Result */

export const CATALOG = Object.freeze({
  version: 1,
  currency: 'USD',
  freeCreations: 1,
  maxReprocesses: 3,
  renewalGraceDays: 3,
  products: Object.freeze([
    Object.freeze({ id: 'single', kind: 'credits', title: '1 buddy', blurb: 'Make one buddy from your own video.', credits: 1, priceCents: 99 }),
    Object.freeze({ id: 'pack5', kind: 'credits', title: '5 buddies', blurb: 'Five buddies. Credits never expire.', credits: 5, priceCents: 399 }),
    Object.freeze({ id: 'creator_monthly', kind: 'subscription', title: 'Creator plan', blurb: '10 buddies every month and priority processing. Cancel anytime.', credits: 10, priceCents: 299 }),
  ]),
});

const DAY = 86_400_000;

/** `ms` plus `n` calendar months in UTC. A day that doesn't exist in the target month becomes its last day (Jan 31 + 1 = Feb 28). */
export function addMonths(ms, n) {
  const d = new Date(ms);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const y = Math.floor(total / 12), m = total - y * 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/** Which monthly period `now` falls in, counting from `anchor` (0 = the first month). Each period starts at addMonths(anchor, k). */
export function periodIndex(anchor, now) {
  const a = new Date(anchor), b = new Date(now);
  let k = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  while (k > 0 && addMonths(anchor, k) > now) k--;
  return Math.max(0, k);
}

export function formatPrice(cents, currency = CATALOG.currency) {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}

const ok = (code = 'ok', extra = {}) => ({ ok: true, code, ...extra });
const fail = code => ({ ok: false, code });
const count = v => (Number.isInteger(v) && v >= 0 ? v : 0);

/**
 * One user's balance and history. Spending order for a new buddy: this month's plan allowance (it expires),
 * then the free buddy, then bought credits (they never expire). Every method checks its input and returns a
 * Result instead of throwing, so a bad receipt or a double tap can't corrupt the wallet.
 */
export class Wallet {
  /** @param {object} [state] what toJSON() returned earlier */
  constructor(state = {}, catalog = CATALOG) {
    this.catalog = catalog;
    const s = state && typeof state === 'object' ? state : {};
    this.freeUsed = count(s.freeUsed);
    this.credits = count(s.credits);
    const sub = s.sub;
    this.sub = sub && typeof sub.productId === 'string' && Number.isFinite(sub.anchor) && count(sub.paidPeriods) > 0
      ? { productId: sub.productId, anchor: sub.anchor, paidPeriods: sub.paidPeriods, autoRenew: sub.autoRenew !== false, usedPeriod: count(sub.usedPeriod), used: count(sub.used) }
      : null;
    this.payments = {};
    for (const [id, p] of Object.entries(s.payments ?? {})) {
      if (p && typeof p.productId === 'string') this.payments[id] = { productId: p.productId, credits: count(p.credits), refunded: !!p.refunded };
    }
    this.creations = {};
    for (const [id, c] of Object.entries(s.creations ?? {})) {
      if (c && ['free', 'credit', 'subscription'].includes(c.source)) {
        this.creations[id] = { source: c.source, period: count(c.period), runs: Math.max(1, count(c.runs)), refunded: !!c.refunded };
      }
    }
  }

  toJSON() {
    return { freeUsed: this.freeUsed, credits: this.credits, sub: this.sub, payments: this.payments, creations: this.creations };
  }

  /** @returns {Product|undefined} */
  product(id) { return this.catalog.products.find(p => p.id === id); }

  paidThrough() { return this.sub ? addMonths(this.sub.anchor, this.sub.paidPeriods) : null; }

  /** Plan allowance left at `now`, or null when there's no active plan. */
  #subLeft(now) {
    const s = this.sub;
    if (!s || now < s.anchor || now >= this.paidThrough()) return null;
    const perPeriod = this.product(s.productId)?.credits ?? 0;
    const used = s.usedPeriod === periodIndex(s.anchor, now) ? s.used : 0;
    return Math.max(0, perPeriod - used);
  }

  /** What the user can spend at `now`. */
  balance(now) {
    const freeLeft = Math.max(0, this.catalog.freeCreations - this.freeUsed);
    const subLeft = this.#subLeft(now);
    return {
      freeLeft,
      credits: this.credits,
      subscription: this.sub
        ? { productId: this.sub.productId, active: subLeft !== null, left: subLeft ?? 0, paidThrough: this.paidThrough(), autoRenew: this.sub.autoRenew }
        : null,
      total: freeLeft + this.credits + (subLeft ?? 0),
    };
  }

  /**
   * Adds what a completed payment bought. Only call this with a receipt your payment provider (or, later, the
   * server) has confirmed. Applying the same receipt id twice is a no-op ('already_applied').
   * @param {Receipt} r
   */
  applyPayment(r) {
    if (!r || typeof r.id !== 'string' || !r.id) return fail('invalid_receipt');
    if (this.payments[r.id]) return ok('already_applied');
    const p = this.product(r.productId);
    if (!p) return fail('unknown_product');
    if (r.status !== 'COMPLETED') return fail('not_completed');
    if (r.currency !== this.catalog.currency) return fail('wrong_currency');
    if (r.amountCents !== p.priceCents) return fail('wrong_amount');
    if (!Number.isFinite(r.at)) return fail('invalid_receipt');

    if (p.kind === 'credits') {
      this.credits += p.credits;
      this.payments[r.id] = { productId: p.id, credits: p.credits, refunded: false };
      return ok();
    }
    const s = this.sub;
    if (s && s.productId === p.id && r.at < this.paidThrough() + this.catalog.renewalGraceDays * DAY) {
      s.paidPeriods += 1;                       // a renewal: the plan continues from where it was paid up to
      s.autoRenew = true;
    } else {
      this.sub = { productId: p.id, anchor: r.at, paidPeriods: 1, autoRenew: true, usedPeriod: 0, used: 0 };
    }
    this.payments[r.id] = { productId: p.id, credits: 0, refunded: false };
    return ok();
  }

  /** Spends one buddy for creation `id`. Call before uploading the video. */
  startCreation(id, now) {
    if (typeof id !== 'string' || !id) return fail('invalid_id');
    if (this.creations[id]) return fail('duplicate_creation');
    let source, period = 0;
    const subLeft = this.#subLeft(now);
    if (subLeft) {
      const k = periodIndex(this.sub.anchor, now);
      this.sub.used = this.sub.usedPeriod === k ? this.sub.used + 1 : 1;
      this.sub.usedPeriod = k;
      source = 'subscription';
      period = k;
    } else if (this.freeUsed < this.catalog.freeCreations) {
      this.freeUsed += 1;
      source = 'free';
    } else if (this.credits > 0) {
      this.credits -= 1;
      source = 'credit';
    } else {
      return fail('no_credits');
    }
    this.creations[id] = { source, period, runs: 1, refunded: false };
    return ok('ok', { source });
  }

  /** A free re-do of creation `id` (new trim, new settings). Limited per buddy so one purchase can't become endless GPU runs. */
  reprocess(id) {
    const c = this.creations[id];
    if (!c) return fail('unknown_creation');
    if (c.refunded) return fail('refunded');
    if (c.runs >= 1 + this.catalog.maxReprocesses) return fail('reprocess_limit');
    c.runs += 1;
    return ok();
  }

  /** Gives back the buddy spent on creation `id`, for when processing failed on our side. */
  refundCreation(id, now) {
    const c = this.creations[id];
    if (!c) return fail('unknown_creation');
    if (c.refunded) return fail('already_refunded');
    c.refunded = true;
    if (c.source === 'free') this.freeUsed = Math.max(0, this.freeUsed - 1);
    else if (c.source === 'credit') this.credits += 1;
    else if (this.#subLeft(now) !== null && this.sub.usedPeriod === c.period && periodIndex(this.sub.anchor, now) === c.period) {
      this.sub.used = Math.max(0, this.sub.used - 1);
    } else {
      this.credits += 1;                         // its month is over, so it comes back as a credit that doesn't expire
    }
    return ok();
  }

  /** The provider refunded or reversed payment `id`: take back what it bought (credits already spent stay spent). */
  refundPayment(id) {
    const p = this.payments[id];
    if (!p) return fail('unknown_payment');
    if (p.refunded) return fail('already_refunded');
    p.refunded = true;
    const product = this.product(p.productId);
    if (product?.kind === 'subscription') {
      if (this.sub && this.sub.productId === p.productId) {
        this.sub.paidPeriods -= 1;
        if (this.sub.paidPeriods <= 0) this.sub = null;
      }
    } else {
      this.credits = Math.max(0, this.credits - p.credits);
    }
    return ok();
  }

  /** The user turned off renewal. The plan keeps working until it's paid up to. */
  cancelSubscription() {
    if (!this.sub) return fail('no_subscription');
    this.sub.autoRenew = false;
    return ok();
  }
}
