const DB_NAME = 'pika-places-v1';
export async function openStore() {
  if (!globalThis.indexedDB) throw new Error('This browser cannot keep pending changes safely. Use a normal Safari or Chrome tab.');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of ['records', 'outbox']) request.result.createObjectStore(name, { keyPath: 'id' });
      request.result.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const transaction = (names, mode, execute) => new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode); let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Could not save on this device.'));
    tx.onabort = () => reject(tx.error || new Error('Device storage is full or unavailable.'));
    execute(tx, value => { result = value; });
  });
  const all = name => transaction([name], 'readonly', (tx, done) => { tx.objectStore(name).getAll().onsuccess = e => done(e.target.result); });
  return {
    records: () => all('records'),
    jobs: async () => (await all('outbox')).sort((a,b) => a.order - b.order),
    meta: key => transaction(['meta'], 'readonly', (tx, done) => { tx.objectStore('meta').get(key).onsuccess = e => done(e.target.result?.value); }),
    enqueue: job => transaction(['outbox', 'meta'], 'readwrite', (tx, done) => {
      const meta = tx.objectStore('meta');
      meta.get('sequence').onsuccess = e => {
        const order = (e.target.result?.value || 0) + 1;
        const stored = { ...job, order };
        meta.put({ key: 'sequence', value: order }); tx.objectStore('outbox').add(stored); done(stored);
      };
    }),
    updateJob: (jobId, patch) => transaction(['outbox'], 'readwrite', (tx) => {
      const outbox = tx.objectStore('outbox');
      outbox.get(jobId).onsuccess = e => { if (e.target.result) outbox.put({ ...e.target.result, ...patch }); };
    }),
    discard: jobId => transaction(['outbox'], 'readwrite', tx => {
      const outbox = tx.objectStore('outbox');
      outbox.get(jobId).onsuccess = e => {
        const job = e.target.result; if (!job) return;
        outbox.delete(jobId);
        if (job.kind === 'create') outbox.getAll().onsuccess = event => { for (const other of event.target.result) if (other.placeId === job.placeId) outbox.delete(other.id); };
      };
    }),
    snapshot: ({ places, version, etag }, completed = []) => transaction(['records', 'outbox', 'meta'], 'readwrite', tx => {
      const meta = tx.objectStore('meta');
      meta.get('version').onsuccess = e => {
        if (version >= (e.target.result?.value || 0)) {
          const records = tx.objectStore('records'); records.clear();
          for (const place of places) records.put(place);
          meta.put({ key: 'version', value: version }); meta.put({ key: 'etag', value: etag });
        }
        for (const jobId of completed) tx.objectStore('outbox').delete(jobId);
        meta.put({ key: 'lastSync', value: new Date().toISOString() });
      };
    })
  };
}
