// The pricing section: what's left to spend and the three ways to buy more.
// The wallet is kept in this browser until Google sign-in and the server arrive; then it moves to the account.

import { CATALOG, Wallet, formatPrice } from './billing.js';
import { PaymentError, devProvider, pickProvider } from './payments.js';

const KEY = 'sb:wallet';
const $ = id => document.getElementById(id);

const MESSAGES = {
  already_applied: 'That payment was already added.',
  unknown_product: "That item isn't for sale any more.",
  not_completed: "The payment didn't go through, so nothing was charged to your balance.",
  wrong_amount: "The amount paid didn't match the price. Nothing was added; contact support if you were charged.",
  wrong_currency: "The payment was in the wrong currency. Nothing was added; contact support if you were charged.",
  invalid_receipt: "The payment couldn't be confirmed. Nothing was added; contact support if you were charged.",
};

function load() {
  try { return new Wallet(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return new Wallet(); }
}
function save(wallet) {
  try { localStorage.setItem(KEY, JSON.stringify(wallet)); } catch { /* storage unavailable: lasts for this visit */ }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const day = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

export function mountShop() {
  const root = $('plans');
  if (!root) return;
  const provider = pickProvider();
  let wallet = load();
  let busy = false;

  const say = (text, isError = false) => {
    const m = $('shop-msg');
    m.textContent = text;
    m.className = `msg ${text ? (isError ? 'err' : 'ok') : ''}`;
  };

  function renderBalance() {
    const b = wallet.balance(Date.now());
    const parts = [];
    if (b.freeLeft) parts.push(`${plural(b.freeLeft, 'free buddy', 'free buddies')}`);
    if (b.credits) parts.push(plural(b.credits, 'credit', 'credits'));
    const s = b.subscription;
    if (s?.active) parts.push(`Creator plan: ${s.left} of ${wallet.product(s.productId)?.credits ?? 0} left this month, ${s.autoRenew ? 'renews' : 'ends'} ${day(s.paidThrough)}`);
    $('balance').textContent = parts.length ? parts.join(' · ') : 'Nothing left to spend. Pick a pack or the Creator plan below.';
    $('balance-total').textContent = String(b.total);
    return b;
  }

  async function buy(product) {
    if (busy) return;
    busy = true;
    render();
    say('');
    try {
      const receipt = await provider.checkout(product);
      const r = wallet.applyPayment(receipt);
      if (!r.ok) { say(MESSAGES[r.code] ?? "The payment couldn't be added.", true); return; }
      save(wallet);
      say(r.code === 'already_applied' ? MESSAGES.already_applied
        : product.kind === 'subscription' ? `You're on the Creator plan: ${product.credits} buddies a month.`
          : `Added ${plural(product.credits, 'buddy', 'buddies')}.`);
    } catch (e) {
      if (!(e instanceof PaymentError && e.cancelled)) say(e instanceof PaymentError ? e.message : 'Checkout failed. Nothing was charged.', true);
    } finally {
      busy = false;
      render();
    }
  }

  async function stopRenewal() {
    if (busy) return;
    busy = true;
    render();
    try {
      await provider.cancelSubscription();
      wallet.cancelSubscription();
      save(wallet);
      const s = wallet.balance(Date.now()).subscription;
      say(`Renewal is off. Your plan keeps working until ${day(s.paidThrough)}.`);
    } catch (e) {
      say(e instanceof PaymentError ? e.message : "Couldn't turn off renewal. Try again.", true);
    } finally {
      busy = false;
      render();
    }
  }

  function card({ title, price, per, blurb, action }) {
    const li = el('li', 'plan');
    li.append(el('h3', '', title));
    const p = el('p', 'price', price);
    if (per) p.append(el('span', '', per));
    li.append(p, el('p', 'blurb', blurb));
    if (action) li.append(action);
    return li;
  }

  function button(label, onClick, { primary = false, disabled = false } = {}) {
    const b = el('button', `btn small${primary ? ' primary' : ''}`, label);
    b.type = 'button';
    b.disabled = disabled || busy || !provider.ready;
    b.addEventListener('click', onClick);
    return b;
  }

  function render() {
    const b = renderBalance();
    root.replaceChildren();
    root.append(card({
      title: 'Your first buddy',
      price: 'Free',
      blurb: 'Every account gets one buddy on us.',
      action: el('p', 'included', b.freeLeft ? 'Included' : 'Used'),
    }));
    for (const p of CATALOG.products) {
      const sub = p.kind === 'subscription';
      const active = sub && b.subscription?.active && b.subscription.productId === p.id;
      let action;
      if (!active) action = button(sub ? 'Subscribe' : 'Buy', () => buy(p), { primary: p.id === 'pack5' });
      else if (b.subscription.autoRenew) action = button('Turn off renewal', stopRenewal);
      else action = el('p', 'included', `Ends ${day(b.subscription.paidThrough)}`);
      root.append(card({
        title: p.title,
        price: formatPrice(p.priceCents),
        per: sub ? ' / month' : p.credits > 1 ? ` · ${formatPrice(Math.round(p.priceCents / p.credits))} each` : '',
        blurb: p.blurb,
        action,
      }));
    }
    $('shop-note').textContent = provider === devProvider
      ? 'Test payments are on because this is a local server: no money moves.'
      : provider.ready ? `Payments by ${provider.name}.` : "Checkout isn't switched on yet.";
  }

  render();
  // Keep "left this month" and plan end dates honest when the tab stays open across a renewal.
  setInterval(renderBalance, 60_000);
  addEventListener('storage', e => { if (e.key === KEY) { wallet = load(); render(); } });
}

mountShop();
