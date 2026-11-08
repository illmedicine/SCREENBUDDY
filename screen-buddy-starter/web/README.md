# Screen Buddy web player

A separate, compatible version of Screen Buddy for the browser. It plays the same buddy packages as the Android app but shares no code with it. Plain HTML, CSS and ES modules: no build step.

## Run it

```bash
python -m http.server 8765        # then open http://localhost:8765
npm test                          # Node 20+: animator, manifest and zip tests
```

## Publish

The site is deployed to Firebase Hosting at https://screenbuddy.web.app by `.github/workflows/firebase.yml` on every push to `main` that
touches this folder (it runs `npm test` first). Setup and manual deploys: `../FIREBASE.md`. The old GitHub Pages address only forwards
to the new one (`.github/pages-redirect/`). All paths are relative, so the folder also works under any other address.

## Notes

- `buddies/` holds the built-in buddies (folders for the player, `.zip` copies for download). The Armani samples are regenerated with `python tools/make_sample_buddies.py <ArmaniWest repo> web/buddies --web`; creator buddies are added with `python tools/publish_buddy.py <package dir>` (see `pipeline/creators/README.md`).
- Imported buddies are stored in the visitor's browser (IndexedDB) and never uploaded.
- `js/animator.js` mirrors the Android `BuddyAnimator`; keep their behaviour in step.
- Pages: `index.html` (landing, with "Sign in with Google" calls to action), `player.html` (try a buddy on the page), `dashboard.html` (signed in: make a buddy from a video link, own buddies, the collection, favorite creators, pricing) and `admin.html` (owner only: hide buddies, pick the featured one, switch off people's buddies, stats).
- `js/cloud.js` loads Firebase once per page; `js/account.js` is the sign-in button and profile; `js/collection.js` merges `buddies/index.json` with the admin's settings in Firestore; `js/library.js` holds the shared rules (links, characters, stats batching) and is unit-tested. Data model and rules: `../FIREBASE.md`.
- `js/billing.js` (prices and wallet), `js/payments.js` (PayPal goes here), `js/shop.js` (the pricing section on the dashboard) and `js/wallet-store.js` (the wallet in the signed-in account, in Firestore) are the store. On `localhost` the buttons make test payments, which the rules accept only while the admin's test-payment switch is on. See `../billing/README.md`.
- The floating buddy (`js/app.js`) also shows the signed-in person's ready buddies and reports selections and time on screen to `stats/` once a minute (`../pipeline/queue/README.md`).
- `js/motion.js` holds the movement modes (touch / steady / typing / sound). Its two gates mirror `windows/src/ScreenBuddy.Core/Motion.cs`. In a browser, typing is only seen while the page is focused, and sound asks for the microphone, measures loudness only and releases the mic when you switch the mode off, pause or hide the buddy.
