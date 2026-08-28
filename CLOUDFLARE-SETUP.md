# Connect Pika Places to Cloudflare

## Before you start

You need a GitHub repository, a Cloudflare account, a D1 database, and an R2 bucket. **This app uses Cloudflare Pages, not the Workers “Import a repository” flow.** No domain purchase is required; you can use the Pages address.

The app has no user login. You will still need to sign in to **your Cloudflare account** to create infrastructure. Cloudflare services have usage limits and possible charges. R2 requires activating its subscription; review the [R2 setup](https://developers.cloudflare.com/r2/get-started/) and [pricing](https://developers.cloudflare.com/r2/pricing/) before enabling it. This ZIP cannot create those resources for you.

## 1. Upload the repository files

Extract `pika-places-cloudflare.zip`. Open the `pika-places` folder and upload **its contents** to the root of your repository.

At the top level of GitHub, you should see `package.json`, `public`, `functions`, `server`, and `migrations`. Keep all of them. Do not upload the ZIP itself as the application and do not upload only the public folder.

## 2. Create the shared D1 database

In Cloudflare, open **Storage & databases → D1 SQL database → Create database**. Name it `pika-places-db`.

Open its **Console** and run the SQL from `migrations/0001_initial.sql`. If your dashboard editor cannot execute the entire file, run each complete statement separately (a `CREATE TRIGGER ... BEGIN ... END;` block is one statement), or use the CLI alternative below.

Confirm this query returns one row:

```sql
SELECT * FROM app_meta;
```

It should contain `id = 1` and `version = 0` for a brand-new database. Re-running the provided schema does not erase existing places.

## 3. Create the media bucket

Open **Storage & databases → R2 → Create bucket**. Name it `pika-places-media`.

Use a **Standard** bucket. Leave the bucket's public `r2.dev` URL disabled. The app serves files through its own API, so no public bucket URL, CORS rule, API key or R2 access key is needed. The app's API is public by design.

## 4. Connect the repo to Cloudflare Pages

Open **Workers & Pages → Create application → Pages → Connect to Git** (the labels may vary slightly). Connect the GitHub repository and use these values:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Production branch | Your main branch, usually `main` |
| Build command | `npm run build` |
| Build output directory | `public` |
| Root directory | Leave blank if files are at the repository root |
| Build environment variable | `NODE_VERSION` = `24` |

Deploy once to create the Pages project. It is normal for the first deployment to show **Cloud setup needed** before the next step. Do not enable Cloudflare Access or any login gate if you want the requested public app.

See Cloudflare's [Git integration guide](https://developers.cloudflare.com/pages/get-started/git-integration/) for the current dashboard flow.

## 5. Add both production bindings

Open your **Pages project → Settings → Bindings → Add** and add:

| Type | Variable name — exact spelling | Resource |
| --- | --- | --- |
| D1 database | `DB` | `pika-places-db` |
| R2 bucket | `MEDIA` | `pika-places-media` |

Set the production compatibility date to `2026-08-28` or later. No compatibility flags are required.

Save the bindings, then **redeploy the latest production commit**. Adding bindings without redeploying is not sufficient. Cloudflare documents the [D1 and R2 binding steps here](https://developers.cloudflare.com/pages/functions/bindings/).

For preview branches, create separate D1/R2 resources, apply the same schema, and bind them in the Preview environment. Do not give an untrusted preview production data access. If you are not using previews, you do not need preview bindings.

### Optional app limits

The following are runtime environment variables, not secrets. The defaults already work without setting them:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_PLACES` | `1000` | Maximum stored places, including Trash |
| `MAX_STORAGE_MB` | `512` | Total media bytes, including removed or pending files |
| `WRITES_PER_MINUTE` | `90` | Write requests per IP per minute |

These application limits do not cap your Cloudflare bill or stop distributed abuse. Set usage alerts and appropriate Cloudflare security controls. There is also a fixed maximum of 8 active files per place and 25 MB per file.

## 6. Check the app before using it

Open your production Pages address and then open `/api/health` on the same address. It should return:

```json
{"ready":true,"database":true,"media":true,"public":true,"maxFileBytes":26214400}
```

1. Save a place with a name, state and area. Wait until the app says **Up to date**.
2. Open the exact same production address on another phone or browser. It should show the place without a login.
3. Edit a note on the second device. The first should refresh within about five seconds while open and online.
4. Upload a screenshot. Wait until it is marked **Screenshot / photo saved**, then verify it on the second device.
5. Move the test place to Trash and restore it from Settings → Trash. Check both devices.
6. Temporarily go offline after loading the app, edit a note, then reconnect with the app still open. Confirm that it changes from pending to Up to date.

Live Cloudflare and real-device testing must happen after you connect your account. Automated local tests are included; they do not substitute for this final production check.

## 7. Add it to your phone

On iPhone, open the production address in Safari → Share → Add to Home Screen. Use the same address on all devices. The icon and manifest are included. This is an installable web app; it is not an App Store package.

## CLI alternative for database setup or deployment

Use this only if you prefer a terminal. Run commands from the repo folder:

```sh
npm ci
npx wrangler login
npx wrangler d1 create pika-places-db
npx wrangler r2 bucket create pika-places-media
```

Skip the two create commands if you already created the resources in the dashboard. Copy `wrangler.example.jsonc` to `wrangler.jsonc`, replace the placeholder with the real D1 database ID, and confirm both resource names. Then:

```sh
npx wrangler d1 execute DB --remote --file migrations/0001_initial.sql
npm run build
```

For a Git-connected Pages project, continue using Git deployments. For an optional new CLI-deployed project:

```sh
npx wrangler pages project create pika-places --production-branch main
npx wrangler pages deploy public --project-name pika-places
```

When `wrangler.jsonc` exists, it becomes the configuration source of truth; use it consistently instead of conflicting dashboard settings. The supplied `wrangler.local.jsonc` is **only for local development** and must not be deployed to production.

## Troubleshooting

| What you see | Check |
| --- | --- |
| Cloud setup needed | D1 is bound as `DB`; the SQL schema ran; you redeployed. |
| Media storage is not connected | R2 is bound as `MEDIA`; the bucket exists; you redeployed. |
| API responds with an HTML page | `functions` and `server` are at the repo root. Deploy through Pages Git/CLI with Functions, not a static upload. |
| Different places on each device | Both devices use the same production URL and production bindings. Preview and local URLs may use different data. |
| Pending / Not synced | Keep the app open with internet. Tap the sync indicator for the exact error and Retry. |
| Video does not play | Use a browser-compatible MP4/WebM codec; the app does not transcode. |
| Upload limit reached | Maximum 8 active files per place, 25 MB per file, and 512 MB total by default. Removed files still occupy storage until owner cleanup. |
| No matching database for local CLI | Use the included `npm run db:local`, which selects `wrangler.local.jsonc`. |

**Never place Cloudflare API tokens, account passwords or R2 credentials in public JavaScript.** This app does not need any of them in the browser.
