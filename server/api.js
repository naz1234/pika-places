import { CATEGORIES, DEFAULT_PLACE, FIELD_LIMITS, MAX_FILE_BYTES, STATES, STATUSES, safeUrl } from '../public/js/model.js';

export class HttpError extends Error {
  constructor(status, message, code = 'request_error') { super(message); this.status = status; this.code = code; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECURITY = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...SECURITY, ...extra } });
const assert = (ok, status, message, code) => { if (!ok) throw new HttpError(status, message, code); };
const id = value => { assert(UUID.test(value || ''), 400, 'Invalid record identifier.'); return value; };
const now = () => new Date().toISOString();
function limit(env, key, fallback, max) { const value = Number(env[key]); return Number.isFinite(value) && value >= 1 ? Math.min(Math.floor(value), max) : fallback; }
async function hash(value) { const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value; return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join(''); }
export function validateChanges(value, creating = false) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 400, 'Expected place details.');
  const result = creating ? { ...DEFAULT_PLACE } : {};
  for (const [key, input] of Object.entries(value)) {
    assert(Object.hasOwn(DEFAULT_PLACE, key), 400, `Unknown field: ${key}`);
    if (key === 'favourite') { assert(typeof input === 'boolean', 400, 'Favourite must be true or false.'); result[key] = input; continue; }
    assert(typeof input === 'string', 400, `${key} must be text.`);
    const text = input.trim();
    assert(text.length <= FIELD_LIMITS[key], 400, `${key} is too long.`);
    assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text), 400, 'Unsupported control characters.');
    if (key === 'source_url' || key === 'map_url') assert(!text || safeUrl(text), 400, 'Use a complete http:// or https:// link.');
    if (key === 'state') assert(!text || STATES.includes(text), 400, 'Choose a Malaysian state or federal territory.');
    if (key === 'category') assert(CATEGORIES.includes(text), 400, 'Choose a valid category.');
    if (key === 'status') assert(STATUSES.includes(text), 400, 'Choose a valid visit status.');
    if (key === 'title') assert(text.length > 0, 400, 'Give this place a name.');
    result[key] = text;
  }
  if (creating) assert(result.title.length > 0, 400, 'Give this place a name.');
  return result;
}
async function readBytes(request, maximum) {
  const length = Number(request.headers.get('content-length'));
  assert(!length || length <= maximum, 413, 'File or request is too large.', 'too_large');
  assert(request.body, 400, 'The request body is empty.');
  const reader = request.body.getReader(); const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new HttpError(413, 'File or request is too large.', 'too_large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return bytes;
}
export function detectMedia(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 32));
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)) return 'image/png';
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.startsWith('RIFF') && head.slice(8,12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && head.slice(4,8) === 'ftyp' && /^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(head.slice(8,12))) return 'video/mp4';
  if ([26,69,223,163].every((b,i) => bytes[i] === b)) return 'video/webm';
  throw new HttpError(415, 'Upload a JPEG, PNG, WebP, GIF, MP4 or WebM file. SVG, HTML and other file types are not accepted.', 'unsupported_media');
}
function writeGuard(request) {
  const origin = request.headers.get('origin');
  assert(!origin || origin === new URL(request.url).origin, 403, 'Cross-site writes are not allowed.');
  assert(!['cross-site'].includes(request.headers.get('sec-fetch-site')), 403, 'Cross-site writes are not allowed.');
  // This is a CSRF safeguard, NOT authentication. The API is intentionally public.
  assert(request.headers.get('x-pika-client') === '1', 403, 'Missing app request header.');
}
async function rateLimit(request, env) {
  const minute = Math.floor(Date.now() / 60000);
  const key = await hash(`${request.headers.get('cf-connecting-ip') || 'local'}:${minute}`);
  const max = limit(env, 'WRITES_PER_MINUTE', 90, 600);
  const row = await env.DB.prepare('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(key, (minute + 2) * 60000).first();
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Date.now()).run();
  assert(row.count <= max, 429, 'Too many changes at once. Sync will retry shortly.', 'rate_limited');
}
const publicMedia = m => ({ id: m.id, place_id: m.place_id, content_type: m.content_type, size: m.size, name: m.name, created_at: m.created_at, url: `/api/media/${m.id}` });
const publicPlace = (p, media = []) => ({ ...p, favourite: !!p.favourite, media: media.map(publicMedia) });
async function getPlace(env, placeId) {
  const p = await env.DB.prepare('SELECT * FROM places WHERE id = ?').bind(placeId).first();
  assert(p, 404, 'This place no longer exists.', 'not_found');
  const media = await env.DB.prepare("SELECT * FROM media WHERE place_id = ? AND status = 'ready' AND deleted_at IS NULL ORDER BY created_at, id").bind(placeId).all();
  return publicPlace(p, media.results);
}
async function livePlace(env, placeId) {
  const p = await getPlace(env, placeId);
  assert(!p.deleted_at, 409, 'This place was moved to Trash on another device. Restore it before editing.', 'place_deleted');
  return p;
}
async function snapshot(request, env) {
  const version = await env.DB.prepare('SELECT version FROM app_meta WHERE id = 1').first();
  const etag = `"pika-${version.version}"`;
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...SECURITY, ETag: etag } });
  // A batch gives one transaction for the version and corresponding record/media snapshot.
  const rows = await env.DB.batch([
    env.DB.prepare('SELECT version FROM app_meta WHERE id = 1'),
    env.DB.prepare('SELECT * FROM places ORDER BY created_at DESC, id'),
    env.DB.prepare("SELECT * FROM media WHERE status = 'ready' AND deleted_at IS NULL ORDER BY created_at, id")
  ]);
  const grouped = new Map();
  for (const m of rows[2].results) { if (!grouped.has(m.place_id)) grouped.set(m.place_id, []); grouped.get(m.place_id).push(m); }
  return json({ places: rows[1].results.map(p => publicPlace(p, grouped.get(p.id) || [])), version: rows[0].results[0].version }, 200, { ETag: `"pika-${rows[0].results[0].version}"` });
}
async function mutate(request, env, path) {
  assert(request.headers.get('content-type')?.split(';')[0] === 'application/json', 415, 'Send JSON place details.');
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(await readBytes(request, 16384))); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Invalid JSON.'); }
  const mutationId = id(request.headers.get('x-mutation-id'));
  const fingerprint = await hash(`${request.method}:${path}:${JSON.stringify(payload)}`);
  const previous = await env.DB.prepare('SELECT fingerprint FROM mutations WHERE id = ?').bind(mutationId).first();
  if (previous) {
    assert(previous.fingerprint === fingerprint, 409, 'This change identifier was already used.', 'mutation_mismatch');
    return json({ duplicate: true });
  }
  try {
  await rateLimit(request, env);
  const bits = path.split('/').filter(Boolean); const stamp = now(); let operation;
  if (request.method === 'POST' && path === '/api/places') {
    const placeId = id(payload.id); const changes = validateChanges(payload.place, true);
    const existing = await env.DB.prepare('SELECT id FROM places WHERE id = ?').bind(placeId).first();
    assert(!existing, 409, 'A place with this identifier already exists.', 'duplicate_place');
    const fields = Object.keys(changes);
    operation = env.DB.prepare(`INSERT INTO places (id, ${fields.join(', ')}, created_at, updated_at) SELECT ?, ${fields.map(() => '?').join(', ')}, ?, ? WHERE (SELECT count(*) FROM places) < ?`).bind(placeId, ...fields.map(k => k === 'favourite' ? +changes[k] : changes[k]), stamp, stamp, limit(env, 'MAX_PLACES', 1000, 10000));
  } else if (bits[1] === 'places' && bits.length >= 3) {
    const placeId = id(bits[2]);
    if (request.method === 'PATCH' && bits.length === 3) {
      await livePlace(env, placeId); const changes = validateChanges(payload.changes);
      assert(Object.keys(changes).length, 400, 'No changed fields.');
      const fields = Object.keys(changes);
      operation = env.DB.prepare(`UPDATE places SET ${fields.map(k => `${k} = ?`).join(', ')}, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL`).bind(...fields.map(k => k === 'favourite' ? +changes[k] : changes[k]), stamp, placeId);
    } else if (request.method === 'POST' && bits.length === 4 && ['trash', 'restore'].includes(bits[3])) {
      await getPlace(env, placeId);
      operation = env.DB.prepare('UPDATE places SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?').bind(bits[3] === 'trash' ? stamp : null, stamp, placeId);
    } else if (request.method === 'POST' && bits.length === 5 && bits[3] === 'remove-media') {
      await livePlace(env, placeId); const mediaId = id(bits[4]);
      operation = env.DB.prepare("UPDATE media SET deleted_at = ? WHERE id = ? AND place_id = ? AND status = 'ready' AND EXISTS (SELECT 1 FROM places WHERE id = ? AND deleted_at IS NULL)").bind(stamp, mediaId, placeId, placeId);
    }
  }
  assert(operation, 404, 'Unknown action.');
  try {
    const result = await env.DB.batch([operation, env.DB.prepare('INSERT INTO mutations (id, fingerprint, created_at) VALUES (?, ?, ?)').bind(mutationId, fingerprint, stamp)]);
    // A failed conditional mutation must not be acknowledged as a successful edit.
    if (!result[0].meta.changes) {
      await env.DB.prepare('DELETE FROM mutations WHERE id = ?').bind(mutationId).run();
      throw new HttpError(409, 'The collection is full or this record changed. Refresh and try again.', 'condition_failed');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const raced = await env.DB.prepare('SELECT fingerprint FROM mutations WHERE id = ?').bind(mutationId).first();
    if (!raced || raced.fingerprint !== fingerprint) throw error;
  }
  return json({ ok: true });
  } catch (error) {
    // Another tab may complete this exact request between our initial receipt
    // lookup and our place/limit checks. A committed receipt still means success.
    const committed = await env.DB.prepare('SELECT fingerprint FROM mutations WHERE id = ?').bind(mutationId).first();
    if (committed?.fingerprint === fingerprint) return json({ duplicate: true });
    throw error;
  }
}
async function upload(request, env, placeId, mediaId) {
  assert(env.MEDIA, 503, 'Screenshot/video storage is not connected. Bind the R2 bucket as MEDIA and redeploy.', 'storage_setup');
  await livePlace(env, placeId);
  const bytes = await readBytes(request, MAX_FILE_BYTES); assert(bytes.length, 400, 'The file is empty.');
  const contentType = detectMedia(bytes); const digest = await hash(bytes);
  const prior = await env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(mediaId).first();
  if (prior) {
    assert(prior.place_id === placeId && prior.digest === digest && !prior.deleted_at, 409, 'Upload identifier already used.', 'upload_mismatch');
    if (prior.status === 'ready') return json({ media: publicMedia(prior) });
    assert(Date.now() - Date.parse(prior.created_at) > 10 * 60000, 409, 'This upload is still processing. It will retry automatically.', 'upload_busy');
  }
  await rateLimit(request, env);
  let name; try { name = decodeURIComponent(request.headers.get('x-file-name') || 'Saved media'); } catch { name = 'Saved media'; }
  name = name.replace(/[\u0000-\u001f\u007f/\\]/g, '').slice(0,120) || 'Saved media';
  const key = `places/${placeId}/${mediaId}`; const stamp = now();
  if (prior) {
    // Claim an expired pending upload with a compare-and-swap lease. Two tabs
    // must not both retry it and let a failed request remove the other's file.
    const lease = await env.DB.prepare("UPDATE media SET created_at = ? WHERE id = ? AND status = 'pending' AND created_at = ?").bind(stamp, mediaId, prior.created_at).run();
    assert(lease.meta.changes, 409, 'This upload is still processing. It will retry automatically.', 'upload_busy');
  }
  if (!prior) {
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO media (id, place_id, r2_key, content_type, size, name, digest, status, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ? WHERE (SELECT coalesce(sum(size), 0) FROM media) + ? <= ?
      AND (SELECT count(*) FROM media WHERE place_id = ? AND deleted_at IS NULL) < 8
      AND EXISTS (SELECT 1 FROM places WHERE id = ? AND deleted_at IS NULL)`).bind(mediaId, placeId, key, contentType, bytes.length, name, digest, stamp, bytes.length, limit(env, 'MAX_STORAGE_MB', 512, 10240) * 1024 * 1024, placeId, placeId).run();
    if (!r.meta.changes) {
      const raced = await env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(mediaId).first();
      if (raced && raced.place_id === placeId && raced.digest === digest && !raced.deleted_at) {
        if (raced.status === 'ready') return json({ media: publicMedia(raced) });
        throw new HttpError(409, 'This upload is still processing. It will retry automatically.', 'upload_busy');
      }
      throw new HttpError(409, 'Upload could not start: this place may be in Trash, at 8 files, or the shared storage limit is reached.', 'upload_limit');
    }
  }
  try {
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType }, customMetadata: { digest } });
    const r = await env.DB.prepare("UPDATE media SET status = 'ready' WHERE id = ? AND EXISTS (SELECT 1 FROM places WHERE id = ? AND deleted_at IS NULL)").bind(mediaId, placeId).run();
    if (!r.meta.changes) throw new HttpError(409, 'Place was moved to Trash during the upload.', 'place_deleted');
  } catch (e) {
    // Leave metadata in place if cleanup fails, so all bytes remain counted against quota.
    try {
      const owned = await env.DB.prepare("SELECT id FROM media WHERE id = ? AND status = 'pending' AND created_at = ?").bind(mediaId, stamp).first();
      if (owned) { await env.MEDIA.delete(key); await env.DB.prepare("DELETE FROM media WHERE id = ? AND status = 'pending' AND created_at = ?").bind(mediaId, stamp).run(); }
    } catch { /* owner can clean abandoned uploads */ }
    throw e;
  }
  const row = await env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(mediaId).first();
  return json({ media: publicMedia(row) }, 201);
}
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  assert(match && (match[1] || match[2]), 416, 'Unsupported byte range.');
  let start, end;
  if (!match[1]) { const suffix = Number(match[2]); assert(suffix > 0, 416, 'Invalid byte range.'); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
  assert(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size, 416, 'Byte range outside this file.');
  return { offset: start, length: end - start + 1 };
}
async function serveMedia(request, env, mediaId) {
  assert(env.MEDIA, 503, 'Media storage is not connected.', 'storage_setup');
  const row = await env.DB.prepare("SELECT media.* FROM media JOIN places ON places.id = media.place_id WHERE media.id = ? AND media.status = 'ready' AND media.deleted_at IS NULL AND places.deleted_at IS NULL").bind(mediaId).first();
  assert(row, 404, 'File not found.');
  let range;
  try { range = parseRange(request.headers.get('range'), row.size); } catch (e) { if (e.status === 416) return new Response(null, { status: 416, headers: { ...SECURITY, 'Content-Range': `bytes */${row.size}` } }); throw e; }
  const headers = { ...SECURITY, 'Content-Type': row.content_type, 'Accept-Ranges': 'bytes', 'Content-Length': String(range?.length || row.size), 'Content-Disposition': `inline; filename="saved-media"; filename*=UTF-8''${encodeURIComponent(row.name)}` };
  if (range) headers['Content-Range'] = `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size}`;
  if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
  const object = await env.MEDIA.get(row.r2_key, range ? { range } : undefined);
  assert(object, 404, 'The saved file is missing from storage.');
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
export async function handleRequest(request, env) {
  try {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (path === '/api/health' && request.method === 'GET') {
      let database = false;
      if (env.DB) { try { database = !!await env.DB.prepare('SELECT version FROM app_meta WHERE id = 1').first(); } catch { /* schema not applied */ } }
      return json({ ready: database, database, media: !!env.MEDIA, public: true, maxFileBytes: MAX_FILE_BYTES }, database ? 200 : 503);
    }
    assert(env.DB, 503, 'Cloud sync is not connected. Bind a D1 database as DB and run migrations/0001_initial.sql.', 'database_setup');
    if (request.method === 'GET' && path === '/api/places') return await snapshot(request, env);
    const mediaMatch = path.match(/^\/api\/media\/([^/]+)$/);
    if (mediaMatch && ['GET', 'HEAD'].includes(request.method)) return await serveMedia(request, env, id(mediaMatch[1]));
    assert(['POST', 'PATCH', 'PUT'].includes(request.method), 405, 'Method not allowed.');
    writeGuard(request);
    const uploadMatch = path.match(/^\/api\/places\/([^/]+)\/media\/([^/]+)$/);
    if (request.method === 'PUT' && uploadMatch) return await upload(request, env, id(uploadMatch[1]), id(uploadMatch[2]));
    return await mutate(request, env, path);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status, error.status === 429 ? { 'Retry-After': '60' } : {});
    console.error('Pika API error:', error?.message);
    if (/no such table|no such column/i.test(error?.message || '')) return json({ error: 'Database setup is incomplete. Run migrations/0001_initial.sql in your D1 database.', code: 'database_setup' }, 503);
    return json({ error: 'The server could not complete this request. Your pending change can be retried.', code: 'server_error' }, 500);
  }
}
