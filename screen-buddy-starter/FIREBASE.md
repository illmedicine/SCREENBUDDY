# Google Cloud (Firebase): hosting, sign-in and profiles

Project **Screen Buddy** (`screen-buddy-f968b`, project number `520820829327`). Web app id
`1:520820829327:web:6567e29d69c6843e4a54fa`.

## What is wired

| Piece | Where | State |
|---|---|---|
| Hosting | `/firebase.json`, `/.firebaserc`: serves `screen-buddy-starter/web` at **https://screenbuddy.web.app** (the Hosting site `screenbuddy`; the project's default site `screen-buddy-f968b.web.app` still exists but is no longer deployed to) | config in the repo |
| Sign in with Google | `web/js/account.js`, button in the header of the landing page and the player | code done; needs the console steps below |
| Profiles | Firestore `users/{uid}`: `displayName`, `photoURL`, `createdAt`, `updatedAt` | code and rules done; needs the database |
| Security rules | `/firestore.rules` | everything closed except the rules below |
| Wallet (buddy credits) | `users/{uid}/wallet/*` is readable by its owner and **writable by nobody from the app** | rules only; the server side comes later |

The Firebase web settings in `web/js/firebase-config.js` are public identifiers, not secrets. The protection is in the rules
and in who is signed in.

### What the rules allow

- A signed-in person can read, create (once) and edit only their own `users/{uid}`. They can change `displayName` (1 to 40
  characters) and `photoURL` (empty or `https://…`, up to 500 characters), nothing else. The same limits are in
  `web/js/profile.js` and its tests.
- Nobody can delete a profile from the app, and nobody can read anyone else's.
- `users/{uid}/wallet/*`: the owner can read it. Writes are refused, so a visitor can never give themselves credits. Only
  trusted server code (Cloud Functions or Cloud Run with the Admin SDK, which skips the rules) will write it, after
  PayPal confirms a payment. Until that exists, the wallet in the web player stays in the browser, as before.

## One-time steps in the Firebase console

These need the project owner; nothing in the repo can do them.

1. **Authentication**: Build > Authentication > Get started > Sign-in method > **Google** > Enable, pick a support email, Save.
2. **Authorised domains**: Authentication > Settings > Authorized domains. `localhost`, `screen-buddy-f968b.web.app` and `screen-buddy-f968b.firebaseapp.com` are already there. Also add `screenbuddy.web.app`, the public address. Add the
   custom domain too when there is one.
3. **Firestore**: Build > Firestore Database > Create database, production mode, choose a location (it cannot be changed
   later; `nam5` (US multi-region) is a fine default).
4. **Lock the API key to the site** (recommended): Google Cloud Console > APIs & Services > Credentials > the "Browser key"
   > Application restrictions: HTTP referrers > add `https://screenbuddy.web.app/*`, `https://screen-buddy-f968b.firebaseapp.com/*` (the sign-in pop-up runs there),
   and `http://localhost:*/*`.

## Deploy

Needs the Firebase CLI (`npm install -g firebase-tools`) and `firebase login`.

```bash
firebase deploy --only firestore:rules --project screen-buddy-f968b    # security rules
firebase deploy --only hosting --project screen-buddy-f968b            # the website
```

The old GitHub Pages address (`illmedicine.github.io/SCREENBUDDY`) no longer gets the site; it only forwards to `screenbuddy.web.app`.

## Automatic deploys

`.github/workflows/firebase.yml` deploys the website and the rules on every push to `main` that touches `web/`, `firebase.json`
or `firestore.rules`. It does nothing until the repository has a secret named `FIREBASE_SERVICE_ACCOUNT`.

1. Google Cloud Console > IAM & Admin > Service accounts, with project `screen-buddy-f968b` selected > **Create service account**.
   Name it `github-deploy`.
2. On the next screen, give it these roles: **Firebase Hosting Admin**, **Firebase Rules Admin**, **Service Usage Consumer**.
   Done.
3. Open the new account > Keys > Add key > Create new key > **JSON**. A file downloads. It is a password for your project:
   do not commit it, paste it into a chat or email it.
4. Put it into GitHub without opening it, from the folder where the file was saved:

   ```bash
   gh secret set FIREBASE_SERVICE_ACCOUNT --repo illmedicine/SCREENBUDDY < github-deploy-key.json
   ```

   (or GitHub > repository Settings > Secrets and variables > Actions > New repository secret, paste the file's contents).
5. Delete the downloaded file. Run the workflow once from Actions > Deploy to Firebase > Run workflow to check.

The other platforms already release themselves: pushing a tag `windows-v1.2.3` builds and publishes the Windows installer and
update, and `macos-v1.2.3` does the same for the Mac. 

## Next

- Server side: a Cloud Function that records PayPal payments and spends credits in `users/{uid}/wallet`, using the same
  `web/js/billing.js` engine on Node (it has no browser dependencies on purpose).
- Sign in on Android and Windows (Android: Firebase Auth with Google; Windows: a browser sign-in that hands a token back).
- Video uploads to Cloud Storage and the processing pipeline.
- Automatic hosting deploys from GitHub Actions (needs a service account secret).
