# Pika Places

A mobile-first shared place book for Malaysia. Save the food spots, cafés, stays and activities you discover on Facebook and TikTok; find them later by state or area.

**Start with [CLOUDFLARE-SETUP.md](CLOUDFLARE-SETUP.md).** This is a complete source repository for **Cloudflare Pages + D1 + R2**, not a static-only demo. It is not deployed yet.

## Included

- Cream, yellow and forest-green phone interface; responsive desktop layout.
- Search and filter by state, town/area, category and visit status.
- Quick filters for Melaka, Johor and Klang, plus areas you add.
- Original-post link, separate map link, notes, favourites and trip collections.
- “To identify” inbox for places without a known location.
- Automatic field saving after a short pause; no Save button is required in the form.
- Shared records in D1 and uploaded screenshots/photos/videos in R2.
- Automatic cross-device refresh while the app is open, normally within about five seconds of a successful save.
- Durable browser outbox, offline retries, idempotent writes, and visible sync errors.
- Recoverable Trash. No anonymous permanent-delete button.
- Installable home-screen web app, offline app shell and cached place details.

## Public means public

There is **no PIN, login, account or private space**. All visitors use the same collection. Anyone who can reach the app can view, edit, add, upload, download media, and move places to Trash. A private GitHub repo does not make the app private. Search indexing is discouraged with a robots meta tag; this is not access control.

Do not save home addresses, sensitive documents, access codes, or private family media. A public app can be vandalised or abused. Basic same-origin write checks, per-IP rate limiting, file type/size checks, upload caps and soft deletion are included; these do **not** authenticate people or prevent a determined attacker. Configure Cloudflare protections and monitor usage.

## What “saved” means

| State | Meaning |
| --- | --- |
| Link / details only | The source video or image is not copied. A deleted social post may become unavailable. |
| Screenshot / photo saved | An uploaded image is stored in your R2 bucket, independent of the source post. |
| Video saved | An uploaded video file is stored separately in R2. |
| Pending / Not synced | Some changes still exist only in this browser. Keep the app open with a connection. |

Pasting a link does not download its video, import its thumbnail, infer an exact address, or scrape social platforms. Add your own screenshot and place details. Upload video only when you have permission to retain it. Image uploads are resized to 1800 px and re-encoded as JPEG to reduce storage and remove metadata; animated images become still images. Video is stored unchanged, without transcoding. Playback depends on the browser and codec.

## Quick local start

Install Node.js 22.13+ (Node 24 recommended) and run:

```sh
npm ci
npm run db:local
npm run dev
```

Open the address Wrangler prints. These commands use `wrangler.local.jsonc` and local emulated storage, not your Cloudflare account. Local test data is not included in this repository or migrated to production. Localhost on a laptop is not a shared cross-device deployment.

```sh
npm test
npm run build
```

The production build checks syntax/assets and compiles the Pages Functions. The static output directory is **`public`**. `functions` must remain at the repository root beside it; do not upload only `public`.

## Repository layout

```text
public/                   Mobile interface, PWA assets, offline shell
public/js/store.js         IndexedDB snapshots and pending outbox
public/js/sync.js          Shared sync, retries and acknowledgements
functions/api/[[path]].js  Cloudflare Pages API entry
server/api.js             Validation, D1 writes, uploads and media serving
migrations/0001_initial.sql Database schema and version triggers
tests/                    API, sync, and persistence tests
CLOUDFLARE-SETUP.md        Deployment checklist
docs/ARCHITECTURE.md       Sync behaviour and API details
docs/OWNER-OPERATIONS.md   Quotas, backups and maintenance
```

Use the same production URL on each device. Never bind a testing deployment to your live database/bucket unless you intend it to edit the same collection.

No Cloudflare keys or account identifiers are embedded in the client. The default deployment route uses dashboard bindings. Optional CLI configuration is provided separately.
