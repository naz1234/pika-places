# Owner operations

## Back up both kinds of storage

Settings → Export place details writes JSON containing records and media references. It does not include the actual screenshot/video bytes or a complete database history.

Keep a D1 export and a separate copy of your R2 bucket. Use Cloudflare's supported [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) and R2 dashboard/S3-compatible tools from your own authenticated environment. Never put export credentials in the app.

If using a configured `wrangler.jsonc`, a D1 export command is:

```sh
npx wrangler d1 export DB --remote --output pika-places-d1-backup.sql
```

Backups may contain public-but-personal travel notes. Store them appropriately. No backup schedule has been created for you.

## Quotas and cleanup

Defaults: 1,000 place records including Trash, 8 active attachments per place, 25 MB per file and 512 MB total media. Raising limits increases potential usage. The per-IP write limit is not a defence against many IP addresses, and public reads are not rate-limited by the app. Monitor Cloudflare usage and configure platform controls appropriate to the traffic.

Deleted/hidden media bytes are deliberately retained. This makes accidental public deletion recoverable but does not free storage. Review hidden media and abandoned uploads in D1:

```sql
SELECT id, place_id, r2_key, name, size, status, created_at, deleted_at
FROM media
WHERE deleted_at IS NOT NULL OR status = 'pending';
```

The owner can restore a hidden attachment by clearing its `deleted_at` in D1 after verifying its parent and R2 object. For a true permanent purge, first take a backup, carefully identify the object key, remove that specific object from R2, then remove its media row. Never remove a place row while it still has media rows. There is intentionally no unauthenticated permanent-purge endpoint.

A pending upload interrupted by a process shutdown can retry after ten minutes with the same media ID. If its browser was cleared and it will not retry, the owner may clean the corresponding R2 key and pending row after confirming no upload is active.

Mutation receipts prevent old retries overwriting newer changes. Do not casually delete them. The rate-limit table clears expired rows on new writes.

## Before updating the app

Back up data, test new code against separate preview bindings, and deploy the new code without recreating the production database or bucket. Keep existing D1/R2 bindings unchanged. Add numbered SQL migrations for future schema changes. Bump the service worker cache name when changing the app shell. The current app avoids forced service-worker activation during active editing.

## Emergency public-abuse response

You control the Cloudflare account. If there is abuse, restrict access or pause the deployment from Cloudflare, retain a database/bucket backup, and review changes before reopening it. This may temporarily change the intended public access, so it is an owner decision. The app does not contain a hidden administrator login, moderation service or immutable audit trail.
