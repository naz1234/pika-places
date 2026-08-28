# Architecture and sync behaviour

## Deployment

Cloudflare Pages hosts the files in `public`. Pages Functions route `/api/*` to `server/api.js`. D1 binding `DB` stores places, media metadata, mutation receipts and rate counters. R2 binding `MEDIA` stores uploaded bytes. No external database service, maps API key or social-platform API key is required.

The app does not request your current location, monitor travel, scrape Facebook/TikTok, or automatically download source videos. Original links and exact map links are entered by the user. Where an exact map link is missing but an area is known, **Find map** opens a Google Maps text search; it is not a verified pin.

## Shared data

All devices read/write the same collection. Requests carry no identity, authentication cookie, user ID, login token or PIN. Same-origin/custom-header checks reduce browser-driven cross-site writes but are not authentication. Direct API callers can perform the public operations.

Text is validated on the server and rendered with `textContent` in the browser. Database values use prepared parameters. Only explicitly allowed field names can become SQL identifiers. Links must be HTTP(S) without embedded credentials. The server never fetches user-supplied URLs.

## Save pipeline

1. Editing a form queues a per-record change after a 650 ms pause. Done/Close flushes the form first.
2. The operation is written to an IndexedDB outbox before the interface reports that it was kept locally. Uploaded files are also queued as blobs after image preparation.
3. One sync loop sends queued operations in creation order. Web Locks coordinates supported browsers/tabs; UUID idempotency protects retries where two tabs race.
4. The server atomically applies each changed-field patch with its mutation receipt. Retried acknowledged mutations do not reapply an old update over a new one.
5. The client reads a fresh authoritative snapshot and atomically stores it together with removing acknowledged jobs. A lost response or failed follow-up read leaves jobs retryable.
6. While visible, each device polls every five seconds. An ETag derived from database triggers avoids resending an unchanged list. Focus/online events trigger another check. Polling pauses when the tab is hidden.

Different-field edits merge because only touched fields are sent. If two devices edit the same field, the last update successfully received by the server wins. There is no collaborative text editor or complete edit history. Unsynced offline edits can arrive after newer online edits and therefore win for the same field. This is explicit last-arriving-write behaviour.

The browser's own local snapshot version prevents a slow response overwriting a newer local snapshot. Outbox jobs remain separate from snapshots. Whole-list uploads are never used.

## Deletion

Moving a place to Trash sets `deleted_at`; it does not delete the place or its R2 bytes. An ordinary patch/upload cannot restore a tombstone. Restoration is an explicit public action. Attached ready media becomes available again when the parent is restored.

Removing one attachment marks it deleted and hides its API route; its bytes are retained for owner recovery. Public visitors cannot permanently purge the bucket through this API. Trash does not protect against a visitor editing other fields. Keep external backups.

## Uploads

Allowed formats are JPEG, PNG, GIF, WebP, MP4 and WebM. Server-side checks inspect file signatures rather than trusting a supplied MIME type; this is not malware scanning or full media decoding. SVG/HTML are rejected. The route reads a bounded body (25 MB), reserves its size in D1 under the total quota, uploads to R2, then marks the metadata ready. The UI only labels a copy saved after the server is ready.

Media UUID + content digest gives idempotent upload retries. A interrupted pending upload is retryable after ten minutes. In-flight/removed files count toward the total quota. If cleanup of an upload failure also fails, metadata is retained so its bytes remain counted.

Only media attached to a live place is served. Responses include fixed safe Content-Type values, nosniff, same-origin resource policy, no-store, HEAD and byte-range support for video. The bucket itself does not need public access.

## Offline limitations

The service worker caches only the app shell. The IndexedDB snapshot provides previously loaded place details offline. Media is not comprehensively cached for offline viewing, and the service worker never intercepts API writes or fabricates success.

The app must be open with a connection to retry uploads and sync. Mobile browsers can suspend pages in the background. Clearing browser storage, uninstalling the web app, storage eviction or private browsing can remove unsynced jobs. Cloud-synced data is still in D1/R2 and can be read on another device.

## API summary

| Method and route | Action |
| --- | --- |
| GET `/api/health` | D1 schema and media-binding readiness |
| GET `/api/places` | Shared snapshot, including soft-deleted records for Trash |
| POST `/api/places` | Create with client UUID and `place` fields |
| PATCH `/api/places/:id` | Apply `changes` to a live place |
| POST `/api/places/:id/trash` | Move to Trash |
| POST `/api/places/:id/restore` | Restore |
| PUT `/api/places/:id/media/:mediaId` | Upload raw file bytes |
| POST `/api/places/:id/remove-media/:mediaId` | Hide one attachment |
| GET / HEAD `/api/media/:id` | Serve an uploaded file; supports a single byte range |

JSON mutations require `Content-Type: application/json`, `X-Pika-Client: 1`, and a UUID `X-Mutation-Id`. Media uploads use `X-Pika-Client: 1`, content type and an encoded `X-File-Name`. These headers are not secrets.

## Tests

`npm test` uses the Node test runner, real SQLite for D1 SQL behaviour, an R2 byte-store double, and independent client stores. IndexedDB adapter tests use fake-indexeddb. The build compiles the real Pages Functions with Wrangler. Local runtime smoke tests are described in `TEST-REPORT.md`. No live Cloudflare account is assumed by the test suite.
