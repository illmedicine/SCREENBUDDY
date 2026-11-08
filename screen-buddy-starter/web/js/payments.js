// Payment providers: the one place where money is taken. The rest of the app only sees a Receipt.
//
// A provider's checkout(product) must resolve to a Receipt only after the payment is captured (status COMPLETED),
// reject with PaymentError({cancelled: true}) when the buyer closes the window, and reject with PaymentError for
// anything else. The wallet re-checks the product, amount and currency against the catalog and ignores a receipt
// id it has already applied, so retrying is safe.
//
// Receipt: { id, productId, amountCents, currency, status, at }
//   id           PayPal capture id for one-off packs; for the Creator plan, the id of that billing cycle's payment
//   amountCents  integer cents: Math.round(Number(amount.value) * 100)
//   currency     amount.currency_code, e.g. 'USD'
//   status       capture status, 'COMPLETED' when the money moved
//   at           Date.parse(create_time), epoch milliseconds
//
// Until sign-in and the server exist, receipts are applied in the browser, so a determined user could fake one.
// Before real money: verify each order on the server (PayPal Orders API or webhooks) and keep the wallet there.

import { CATALOG } from './billing.js';

export class PaymentError extends Error {
  constructor(message, { cancelled = false } = {}) {
    super(message);
    this.cancelled = cancelled;
  }
}

// ---- PayPal: connect your account here ------------------------------------------------------------------------

export const PAYPAL = {
  clientId: '',                              // REST app client id (sandbox first)
  planIds: { creator_monthly: '' },          // billing plan id for the Creator plan ($2.99 / month)
};

export const paypalProvider = {
  name: 'PayPal',
  /** Set to true once checkout() below really takes payments. */
  ready: false,
  /** @returns {Promise<import('./billing.js').Receipt>} */
  async checkout(product) {
    // Wire PayPal here: one-off packs as an order for product.priceCents in CATALOG.currency, the Creator plan as a
    // subscription on PAYPAL.planIds[product.id]. Resolve with the Receipt described at the top of this file.
    throw new PaymentError(`PayPal checkout isn't connected yet (${product.id}).`);
  },
  /** Turns off renewal of the Creator plan at PayPal. */
  async cancelSubscription() {
    throw new PaymentError("PayPal isn't connected yet.");
  },
};

// ---- test payments, only on a local dev server -----------------------------------------------------------------

export const devProvider = {
  name: 'Test payments',
  ready: true,
  async checkout(product) {
    return {
      id: `dev-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      productId: product.id,
      amountCents: product.priceCents,
      currency: CATALOG.currency,
      status: 'COMPLETED',
      at: Date.now(),
    };
  },
  async cancelSubscription() {},
};

export function isLocalDev(host = globalThis.location?.hostname ?? '') {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}

/** Test payments on a local dev server, PayPal everywhere else. */
export const pickProvider = () => (isLocalDev() ? devProvider : paypalProvider);
