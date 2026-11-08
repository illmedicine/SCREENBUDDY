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
| Wallet (buddy credits) | `users/{uid}/wallet/main`: the `web/js/billing.js` Wallet JSON | code and rules done |
| Dashboard | `web/dashboard.html`, `web/js/dashboard.js`: make a buddy from a video link, own buddies, the collection, favorites, pricing | code and rules done |
| Admin | `web/admin.html`, `web/js/admin.js`, for `demarkuswilsone@gmail.com` only (enforced in the rules) | code and rules done |
| Video uploads | Cloud Storage `uploads/{uid}/{characterId}/video.<ext>`, `/storage.rules`: the owner adds one video (up to 100 MB) per buddy, can't overwrite or delete it, and only they can read it | code and rules done; needs Storage switched on (below) |
| Processing worker | `users/{uid}/characters/*` with `status: 'queued'`; contract in `pipeline/queue/README.md` | not built yet |

The Firebase web settings in `web/js/firebase-config.js` are public identifiers, not secrets. The protection is in the rules
and in who is signed in.

### Data

| Path | Who reads | Who writes |
|---|---|---|
| `users/{uid}` profile: `displayName`, `photoURL`, `buddyId` (the buddy in use, so other devices follow) | owner | owner (name 1 to 40 characters, https picture) |
| `users/{uid}/wallet/main` | owner, admin | owner, checked (below); later the server |
| `users/{uid}/characters/{id}` own buddies (fields: `pipeline/queue/README.md`) | owner, admin | owner creates (paid), renames, re-dos (3 free); admin switches off; the worker does the rest |
| `users/{uid}/favorites/{id}` starred creators `{name, link}` | owner | owner |
| `buddies/{id}` admin settings for a shared buddy: `name`, `creatorName`, `creatorLink`, `hidden` | everyone | admin |
| `config/site`: `featured` (buddy on the landing page), `clientReceipts` (test payments switch) | everyone | admin |
| `stats/{key}`: `selections`, `seconds` | admin | anyone, +0..10 selections and +0..900 seconds per write |

### What the rules enforce

- **Private:** a person's profile, wallet, buddies and favorites are readable only by them (and wallet and buddies by the admin).
- **One free buddy:** a buddy can only be created in the same write that adds it to the wallet's `creations` and spends
  exactly one buddy: the free one (`freeUsed` 0 → 1, and it never goes back), a credit, or this month's Creator plan
  allowance. Its video link can never be changed, and deleting it gives nothing back, so a new or replacement buddy costs one.
- **Credits:** they only grow with a new payment that adds exactly what the catalog product buys, and only while
  `config/site.clientReceipts` is on. That switch exists because receipts are still applied in the browser (test payments
  on `localhost`); keep it **off** in production. When PayPal is connected, verify each order on the server
  (Admin SDK) and write the payment there; the rules then never need to trust the browser.
- **Admin:** `request.auth.token.email == 'demarkuswilsone@gmail.com'` with `email_verified`, or a custom claim
  `admin: true`. To add another admin, add the address in `firestore.rules` and in `ADMIN_EMAILS` in `web/js/library.js`
  (a test checks they match), or set the claim with the Admin SDK.
- Rules tests run against the emulator: `cd firestore-tests && npm install && npm test` (needs Java and the Firebase CLI).

## One-time steps in the Firebase console

These need the project owner; nothing in the repo can do them.

1. **Authentication**: Build > Authentication > Get started > Sign-in method > **Google** > Enable, pick a support email, Save.
2. **Authorised domains**: Authentication > Settings > Authorized domains. `localhost`, `screen-buddy-f968b.web.app` and `screen-buddy-f968b.firebaseapp.com` are already there. Also add `screenbuddy.web.app`, the public address. Add the
   custom domain too when there is one.
3. **Firestore**: Build > Firestore Database > Create database, production mode, choose a location (it cannot be changed
   later; `nam5` (US multi-region) is a fine default).
4. **Cloud Storage** (for video uploads): Build > Storage > Get started, production mode, same location as Firestore.
   New Storage buckets need the pay-as-you-go **Blaze** plan (there is still a free allowance). Then deploy the rules once:
   `firebase deploy --only storage --project screen-buddy-f968b`. Recommended: a lifecycle rule on the bucket that deletes
   `uploads/` objects after 30 days, since the worker only needs a video until the buddy is made.
5. **Lock the API key to the site** (recommended): Google Cloud Console > APIs & Services > Credentials > the "Browser key"
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

`.github/workflows/firebase.yml` deploys the website and the rules on every push to `main` that touches `web/`, `billing/`,
`firebase.json` or `firestore.rules`. It stores no key: Google trusts GitHub's per-run identity token instead
(Workload Identity Federation), because the organisation policy `iam.disableServiceAccountKeyCreation` forbids service-account keys.

**One-time setup.** Open [Google Cloud Console](https://console.cloud.google.com/?project=screen-buddy-f968b), check the project picker
says `screen-buddy-f968b`, click the **>_** icon (top right) to open Cloud Shell, paste this and press Enter:

```bash
PROJECT_ID=screen-buddy-f968b
PROJECT_NUMBER=520820829327
REPO=illmedicine/SCREENBUDDY
SA=github-deploy@$PROJECT_ID.iam.gserviceaccount.com

gcloud config set project $PROJECT_ID
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com   firebasehosting.googleapis.com firebaserules.googleapis.com

# the account the deploy acts as, with only the roles it needs
gcloud iam service-accounts create github-deploy --display-name="GitHub deploy"
for role in roles/firebasehosting.admin roles/firebaserules.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:$SA" --role=$role --condition=None
done

# let GitHub runs of this repository, on the main branch only, act as that account
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers create-oidc github-actions --location=global --workload-identity-pool=github   --display-name="GitHub Actions" --issuer-uri="https://token.actions.githubusercontent.com"   --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref"   --attribute-condition="assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding $SA --role=roles/iam.workloadIdentityUser   --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

Then, on your own computer, switch the workflow on and test it:

```bash
gh variable set FIREBASE_DEPLOY --body true --repo illmedicine/SCREENBUDDY
gh workflow run "Deploy to Firebase" --repo illmedicine/SCREENBUDDY
```

(or GitHub > Actions > Deploy to Firebase > Run workflow). A green run means it works. The values in the workflow file
(project number, pool, service account) are identifiers, not secrets. Only runs of this repository on `main` can use them.

The other platforms already release themselves: pushing a tag `windows-v1.2.3` builds and publishes the Windows installer and
update, and `macos-v1.2.3` does the same for the Mac. 

## Next

- Server side: a Cloud Function that verifies PayPal payments and writes them into `users/{uid}/wallet/main`, using the same
  `web/js/billing.js` engine on Node (it has no browser dependencies on purpose).
- The processing worker for buddy requests (`pipeline/queue/README.md`) and its index (`firebase deploy --only firestore:indexes`).
- Sign in on Android and Windows (Android: Firebase Auth with Google; Windows: a browser sign-in that hands a token back).
- Automatic hosting deploys from GitHub Actions (needs a service account secret).
