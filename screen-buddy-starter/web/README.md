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
- `js/billing.js` (prices and wallet), `js/payments.js` (PayPal goes here) and `js/shop.js` (the Pricing section) are the store. The wallet is kept in the visitor's browser for now; on `localhost` the buttons make test payments. See `../billing/README.md`.
- `js/motion.js` holds the movement modes (touch / steady / typing / sound). Its two gates mirror `windows/src/ScreenBuddy.Core/Motion.cs`. In a browser, typing is only seen while the page is focused, and sound asks for the microphone, measures loudness only and releases the mic when you switch the mode off, pause or hide the buddy.
