# Verification report

Verified locally on 28 August 2026. No production Cloudflare account or user data was used.

| Check | Result |
| --- | --- |
| Automated test suite | **22 passed, 0 failed** |
| JavaScript syntax and referenced static assets | Passed |
| Static HTML integrity | Unique IDs; direct app element references resolve |
| Cloudflare Pages Functions production compilation | Passed with Wrangler 4.127.0 |
| Local D1 schema application | Passed; 15 SQL commands |
| Local Cloudflare workerd runtime API smoke check | Passed |

## Behaviour exercised

- Shared records visible to two independent simulated devices without authentication.
- Different-field concurrent edits are retained.
- Lost write responses, replayed mutations, simultaneous duplicate creates and failed snapshot reads.
- Offline queue retry after restarting a sync engine.
- IndexedDB adapter persistence of queued blobs and ordering across independent connections, using fake-indexeddb.
- Atomic snapshot acknowledgement and protection against stale snapshots.
- Trash/restore and rejection of stale edits to deleted places.
- Uploaded image storage independent of the social-post URL.
- Rejection of executable uploads, unsafe URLs, unsupported fields and cross-origin writes.
- Rate/record/storage limits, missing bindings and failed R2 writes.
- Media reads, HEAD, partial byte ranges, attachment hiding and preservation for owner recovery.

The runtime smoke check uses the compiled Pages Functions in local workerd/Miniflare with a local D1 database and R2 bucket. It creates and edits a record, reads it with another request, uploads a real PNG, reads part of its bytes, moves it to Trash and restores it. External networking is disabled in this smoke test.

## Not verified here

- Deployment to your Cloudflare account, actual billing configuration or bindings.
- Two physical phones connected to your production URL.
- Visual/interactive browser testing on iPhone or Android.
- Every possible uploaded video codec or corrupt image file.

Complete the production checklist in `CLOUDFLARE-SETUP.md` after deployment. Live syncing cannot operate until D1 is connected and the SQL schema is applied; uploaded media additionally requires the R2 binding.

## Reproduce

```sh
npm ci
npm test
npm run build
node scripts/runtime-smoke.mjs
```

The runtime smoke script uses the version of Miniflare pinned by Wrangler in `package-lock.json`. It creates ephemeral local test data and does not touch Cloudflare production resources.
