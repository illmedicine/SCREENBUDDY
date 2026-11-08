# Billing: prices, wallet and payments

The app is free. People pay only to make buddies from their own videos. Publishing to the community library is free.

| Product | id | Price | What you get |
|---|---|---|---|
| Free | (no product) | $0 | 1 buddy per account, once |
| Single buddy | `single` | $0.99 | 1 credit |
| 5-pack | `pack5` | $3.99 | 5 credits |
| Creator plan | `creator_monthly` | $2.99 / month | 10 buddies each month; unused ones do not carry over |

Every buddy includes up to 3 free re-dos. If making a buddy fails on our side, the buddy is refunded.

## Files

- `catalog.json`: the price list. It is the single source of truth; the web, Android and Windows engines each carry a copy of these values, and their tests fail if a copy drifts.
- `scenarios.json`: shared test vectors. The web (`node --test`), Android (JUnit) and Windows (xUnit) tests replay every scenario, so all three engines give the same answers.

To change a price, edit `catalog.json`, then the matching constants in `web/js/billing.js`, `android/.../billing/Wallet.kt` and `windows/src/ScreenBuddy.Core/Billing/Wallet.cs`, and run all three test suites. Change the price in PayPal too.

## Wallet rules

The engine is the same on every platform (`Wallet` in each). It keeps:

```
{ freeUsed, credits,
  sub: { productId, anchor, paidPeriods, autoRenew, usedPeriod, used } | null,
  payments:  { <receipt id>:  { productId, credits, refunded } },
  creations: { <creation id>: { source, period, runs, refunded } } }
```

The JSON is the same on every platform, so a wallet can move between them (and later to the server). Damaged data loads as an empty wallet.

- **Paying** (`applyPayment(receipt)`): a receipt id is applied once; sending it again returns `already_applied` and changes nothing. The product, amount, currency and `COMPLETED` status are checked against the catalog.
- **Spending** (`startCreation(id, now)`): the Creator plan's allowance for this month is used first, then the free buddy, then credits.
- **Re-dos** (`reprocess(id)`): up to 3 per buddy, free.
- **Failed creation** (`refundCreation(id, now)`): the buddy goes back where it came from. If it came from a plan month that has ended, it comes back as a credit instead.
- **Refunded payment** (`refundPayment(id)`): takes back the credits that are still unspent (never below 0), or one month of the plan.
- **Stopping renewal** (`cancelSubscription()`): the plan keeps working until the end of the paid month.

Creator plan months run from the first payment (`anchor`) in calendar months, clamped to the end of short months (Jan 31 → Feb 28). A renewal that arrives within 3 days of the end of the paid month extends the plan; a later one starts a new plan from that date.

Result codes: `ok`, `already_applied`, `invalid_receipt`, `unknown_product`, `not_completed`, `wrong_currency`, `wrong_amount`, `invalid_id`, `duplicate_creation`, `no_credits`, `unknown_creation`, `refunded`, `reprocess_limit`, `already_refunded`, `unknown_payment`, `no_subscription`.

## Connecting PayPal

Each platform has one payment provider with one job: take the money and return a `Receipt` once the payment is captured.

| Platform | File | Fill in |
|---|---|---|
| Web | `web/js/payments.js` | `PAYPAL.clientId`, `PAYPAL.planIds.creator_monthly`, `paypalProvider.checkout()` / `cancelSubscription()`, then `ready: true` |
| Android | `android/app/src/main/java/ai/illyrobotic/screenbuddy/billing/Payments.kt` | `PayPalPaymentProvider.CLIENT_ID`, `PLAN_IDS`, `checkout()` / `cancelSubscription()`, then `ready = true` |
| Windows | `windows/src/ScreenBuddy.App/Payments.cs` | `PayPalPaymentProvider.ClientId`, `CreatorPlanId`, `CheckoutAsync()` / `CancelSubscriptionAsync()`, then `Ready => true` |

In PayPal: create a REST app (sandbox first) for the client id, and a product with a $2.99 monthly billing plan for the Creator plan. Single and 5-pack are ordinary orders for the catalog price.

The receipt the provider returns:

| Field | From PayPal |
|---|---|
| `id` | the capture id; for the Creator plan, the id of that month's payment |
| `productId` | the catalog id you checked out |
| `amountCents` | `Math.round(Number(amount.value) * 100)` |
| `currency` | `amount.currency_code` (`USD`) |
| `status` | the capture status; `COMPLETED` when money moved |
| `at` | `create_time` as epoch milliseconds |

Return a receipt only after capture. When the buyer closes the PayPal window, throw the payment error with `cancelled` set; the store then says nothing. Any other failure: throw the payment error with a message the buyer can read.

Until PayPal is connected the store shows the prices with the buttons switched off. Test payments (no money moves) are on for `localhost` on the web, debuggable builds on Android and Debug builds on Windows.

## Before taking real money

- **Verify payments on a server.** Right now the receipt is applied on the device, so someone who edits the app or its storage can add credits for free. Once Google sign-in is in, the server should confirm each payment with PayPal (Orders API, or the `PAYMENT.CAPTURE.COMPLETED` and subscription webhooks), keep the wallet per Google account and spend credits when a video is uploaded. `web/js/billing.js` has no browser dependencies, so a Node server can use it as is.
- **Google Play.** Play's payments policy generally requires Google Play Billing for digital goods bought inside an Android app. Selling credits through PayPal inside the Android app risks rejection. Common options: use Play Billing on Android (the provider seam is the place to add it), or sell on the web only and let the Android app spend what the account already has.
- Monthly renewals and refunds come from PayPal webhooks, so they need the server too. The device only sees the payments made on it.
