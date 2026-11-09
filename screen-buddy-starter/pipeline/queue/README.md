# Buddy requests: the processing queue (and stats reporting)

The website's dashboard (`web/dashboard.html`) lets a signed-in person paste a link to a public video. It writes one
Firestore document and the processing worker does the rest. The worker is `pipeline/main.py` (Firebase Functions, Python,
deployed with `firebase deploy --only functions:worker`). It runs `creators/autobuddy.py`, the automatic version of the
hand-made steps: about 1 to 3 minutes per buddy. This is its contract.

The admin page's **Add a buddy** form uses the same worker through `jobs/{jobId}` (admin only: name, creator, video link or
`storagePath` of an upload in `uploads/admin/{jobId}/`, `people`, `quality`: the cleaner, slower cut-out, on unless `false`). A finished job publishes the package to Storage
`buddies/shared/{buddyId}/` and lists it in `catalog/{buddyId}` (`prefix`, `version`, public to read). The website loads
the catalog on every page, and the Windows and Android apps install new catalog buddies on start (`CloudSync`), so a new
shared buddy needs no commit, deploy or app release.

While working, the worker keeps `progress: {stage, pct}` up to date on the job or character, and both pages show it.

## A request

`users/{uid}/characters/{characterId}`, created by the dashboard in the same write that spends one buddy from
`users/{uid}/wallet/main` (the rules refuse it otherwise):

| Field | Set by | Meaning |
|---|---|---|
| `name` | owner | the buddy's name, 1 to 40 characters |
| `videoUrl` | owner, once | the https link to the video (YouTube, TikTok, Instagram, …), or for an uploaded file its Cloud Storage download address (`uploads/{uid}/{characterId}/video.<ext>`). Never changes: a new video is a new, paid buddy |
| `platform` | owner | `Upload` for an uploaded file, else `YouTube`, `TikTok`, `Instagram`, `Facebook`, `X`, `Snapchat`, `Vimeo`, `Twitch` or `Web` |
| `creatorName`, `creatorLink` | owner | the person in the video and their social link (shown wherever the buddy appears) |
| `status` | owner → `queued`; worker after that | `queued` → `processing` → `ready` or `failed` |
| `runs` | owner | 1, then +1 for each free re-do (max 4). A re-do puts a `ready` or `failed` buddy back to `queued` |
| `disabled` | admin | `true` stops it in every app. Skip disabled requests |
| `packagePath` | worker | Storage path of the package folder (`buddies/{uid}/{characterId}/`), public to read. Apps load files with the Storage download address for `packagePath + file` |
| `packageUrl` | (older) | an https folder holding the package; still read when there is no `packagePath` |
| `progress` | worker | `{stage, pct}` while processing |
| `zipUrl` | worker, optional | the same package as a `.zip`, for the Android and Windows apps |
| `error` | worker | a short reason people can read, when `failed` |
| `createdAt`, `updatedAt` | both | server timestamps |

## The worker

Runs with the Firebase Admin SDK (Cloud Run or Cloud Functions), so the security rules don't apply to it. Loop:

1. Find work: `collectionGroup('characters').where('status', '==', 'queued')`. That query needs the single-field
   collection-group index in `/firestore.indexes.json`; deploy it once with
   `firebase deploy --only firestore:indexes --project screen-buddy-f968b`. Creator-plan buddies first (the wallet's
   `creations[id].source == 'subscription'`) for priority processing.
2. Claim it in a transaction: still `queued` and not `disabled` → `status: 'processing'`.
3. Get the video: for `platform: 'Upload'` read the file from Storage with the Admin SDK (and delete it when done), otherwise download `videoUrl` (e.g. `yt-dlp`), then run the offline steps in `pipeline/` (cut out, normalise,
   pack; see `pipeline/creators/README.md`). Respect each site's terms: only videos the person agreed to.
4. Upload the package to Cloud Storage under `buddies/{uid}/{characterId}/` (public read, CORS allowing
   `https://screenbuddy.web.app`), then set `status: 'ready'`, `packageUrl`, `zipUrl`, `updatedAt`.
5. On failure on our side: `status: 'failed'`, `error`, and refund the buddy in the same transaction with the
   `web/js/billing.js` engine: `new Wallet(data).refundCreation(characterId, Date.now())`, then write `toJSON()` back.

The web app shows the status live and, once `ready`, loads the package from `packageUrl` in the floating buddy
(`web/js/app.js`).

## Stats (selections and time on screen)

`stats/{key}` holds two counters: `selections` (times the buddy was picked) and `seconds` (time it was visible on a
screen). `key` is the shared buddy's id (`kiah`) or `<uid>__<characterId>` for a person's own buddy. Only the admin can
read them (`web/admin.html`).

Every app reports the same way: count in memory, then at most once a minute (and when the app goes to the background)
merge one small increment per buddy:

```js
setDoc(doc(db, 'stats', key), { selections: increment(n), seconds: increment(s), updatedAt: serverTimestamp() }, { merge: true })
```

The rules accept 0 to 10 selections and 0 to 900 seconds per write and nothing else; anything over that waits for the
next write (`StatsTally` in `web/js/library.js` does this for the web). Signing in is not needed for shared buddies;
own buddies need the owner's sign-in.

- **Windows / Mac:** the Firestore REST API, `projects/screen-buddy-f968b/databases/(default)/documents:commit` with a
  `transform` write using `fieldTransforms: [{fieldPath: 'selections', increment: {integerValue: n}}, …]` and
  `updatedAt: setToServerValue REQUEST_TIME`. Anonymous calls only need the web API key from `web/js/firebase-config.js`.
- **Android:** the Firestore SDK, `FieldValue.increment(n)` with `SetOptions.merge()`.

Apps should also skip shared buddies whose `buddies/{id}` document has `hidden: true`, and a person's own buddies with
`disabled: true`.

Deploying the worker (`firebase deploy --only functions:worker`) needs, once per project: the default compute service account
holding roles/cloudbuild.builds.builder, logging.logWriter, artifactregistry.writer, storage.objectAdmin and datastore.user;
the bucket CORS from `cors.json` (so browsers can load published buddies); and the storage rules deployed. `lib/` carries
libEGL/libGLESv2 (libglvnd, MIT), which MediaPipe needs and the Cloud Functions image lacks; main.py loads them.
