# Buddy requests: the processing queue (and stats reporting)

The website's dashboard (`web/dashboard.html`) lets a signed-in person paste a link to a public video. It does not
upload files. It writes one Firestore document and the processing worker does the rest. The worker does not exist yet;
this is its contract.

## A request

`users/{uid}/characters/{characterId}`, created by the dashboard in the same write that spends one buddy from
`users/{uid}/wallet/main` (the rules refuse it otherwise):

| Field | Set by | Meaning |
|---|---|---|
| `name` | owner | the buddy's name, 1 to 40 characters |
| `videoUrl` | owner, once | the https link to the video (YouTube, TikTok, Instagram, …). Never changes: a new video is a new, paid buddy |
| `platform` | owner | `YouTube`, `TikTok`, `Instagram`, `Facebook`, `X`, `Snapchat`, `Vimeo`, `Twitch` or `Web` |
| `creatorName`, `creatorLink` | owner | the person in the video and their social link (shown wherever the buddy appears) |
| `status` | owner → `queued`; worker after that | `queued` → `processing` → `ready` or `failed` |
| `runs` | owner | 1, then +1 for each free re-do (max 4). A re-do puts a `ready` or `failed` buddy back to `queued` |
| `disabled` | admin | `true` stops it in every app. Skip disabled requests |
| `packageUrl` | worker | https folder holding `manifest.json`, `face.webp` and the strips (the same package format as `web/buddies/<id>/`) |
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
3. Download the video from `videoUrl` (e.g. `yt-dlp`), then run the offline steps in `pipeline/` (cut out, normalise,
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
