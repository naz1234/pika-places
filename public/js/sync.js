import { projectPlaces } from './model.js';

export function jobRequest(job) {
  const headers = { 'X-Pika-Client': '1', 'X-Mutation-Id': job.id };
  let path = `/api/places/${job.placeId}`, method = 'POST', body = {};
  if (job.kind === 'upload') return { path: `${path}/media/${job.mediaId}`, options: { method: 'PUT', headers: { ...headers, 'Content-Type': job.blob.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(job.name) }, body: job.blob } };
  if (job.kind === 'create') { path = '/api/places'; body = { id: job.placeId, place: job.data }; }
  else if (job.kind === 'patch') { method = 'PATCH'; body = { changes: job.data }; }
  else if (job.kind === 'trash' || job.kind === 'restore') path += `/${job.kind}`;
  else if (job.kind === 'remove-media') path += `/remove-media/${job.mediaId}`;
  else throw new Error('Unknown pending action.');
  return { path, options: { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) } };
}
export class SyncEngine {
  constructor(store, { fetcher = (...args) => fetch(...args), onChange = () => {}, onStatus = () => {}, channel = null } = {}) {
    Object.assign(this, { store, fetcher, onChange, onStatus, channel });
    this.running = false; this.nextAttempt = 0; this.failures = 0; this.state = 'checking'; this.message = 'Connecting…';
  }
  async view() { return projectPlaces(await this.store.records(), await this.store.jobs()); }
  async notify() { this.onChange(await this.view(), await this.store.jobs()); }
  setStatus(state, message) { this.state = state; this.message = message; this.onStatus({ state, message }); }
  async enqueue(kind, placeId, extra = {}) {
    const job = { id: crypto.randomUUID(), kind, placeId, createdAt: new Date().toISOString(), ...extra };
    await this.store.enqueue(job); // Do not show "saved" before durable storage succeeds.
    await this.notify(); this.channel?.postMessage('changed');
    this.setStatus('pending', 'Waiting to sync');
    // Do not bypass backoff while users are typing or adding more files.
    void this.sync(); return job;
  }
  async retry() { for (const j of await this.store.jobs()) if (j.error) await this.store.updateJob(j.id, { error: null }); this.nextAttempt = 0; return this.sync(); }
  async sync(force = false) {
    if (this.running || (!force && Date.now() < this.nextAttempt)) return;
    this.running = true;
    const run = async () => {
      let completed = []; let failure = null; let permanent = false;
      try {
        const jobs = await this.store.jobs();
        if (jobs.length) this.setStatus('syncing', `Syncing ${jobs.length} change${jobs.length === 1 ? '' : 's'}…`);
        for (const job of jobs.slice(0, 30)) {
          if (job.error) { permanent = true; failure = new Error(job.error); break; }
          const { path, options } = jobRequest(job);
          let response;
          try { response = await this.fetcher(path, { ...options, cache: 'no-store', signal: AbortSignal.timeout(job.kind === 'upload' ? 120000 : 20000) }); }
          catch (e) { failure = e; break; }
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            failure = new Error(data.error || `Sync request failed (${response.status}).`);
            permanent = [400, 403, 404, 413, 415].includes(response.status) || (response.status === 409 && data.code !== 'upload_busy');
            if (permanent) await this.store.updateJob(job.id, { error: failure.message });
            if (response.status === 429) this.nextAttempt = Date.now() + 60000;
            break;
          }
          completed.push(job.id);
        }
        const etag = completed.length ? null : await this.store.meta('etag');
        const response = await this.fetcher('/api/places', { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {}, signal: AbortSignal.timeout(20000) });
        if (response.status !== 304) {
          if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Cloud sync is unavailable.'); }
          const data = await response.json();
          if (!Array.isArray(data.places) || !Number.isSafeInteger(data.version)) throw new Error('Unexpected sync response.');
          // Remove acknowledged jobs atomically WITH their new cloud snapshot.
          await this.store.snapshot({ ...data, etag: response.headers.get('etag') }, completed);
          this.channel?.postMessage('changed');
        }
        await this.notify();
        if (failure) throw failure;
        this.failures = 0; this.nextAttempt = 0;
        const remaining = await this.store.jobs();
        this.setStatus(remaining.length ? 'pending' : 'synced', remaining.length ? 'Waiting to sync' : 'Up to date');
      } catch (error) {
        this.failures++;
        this.nextAttempt = Math.max(this.nextAttempt, Date.now() + Math.min(60000, 2000 * 2 ** Math.min(this.failures, 5)));
        this.setStatus(permanent ? 'error' : 'offline', permanent ? error.message : (typeof navigator !== 'undefined' && !navigator.onLine ? 'Offline · changes waiting' : error.message || 'Unable to sync · will retry'));
        await this.notify();
      }
    };
    try {
      if (globalThis.navigator?.locks) await navigator.locks.request('pika-places-cloud-sync', { ifAvailable: true }, async lock => { if (lock) await run(); });
      else await run();
    } finally { this.running = false; }
  }
}
