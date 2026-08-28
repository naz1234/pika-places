import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openStore } from '../public/js/store.js';

test('IndexedDB persists queued blobs and provides atomic ordering across tabs',async()=>{
  globalThis.indexedDB=new IDBFactory();const a=await openStore(),b=await openStore();const placeId=crypto.randomUUID();
  await Promise.all([a.enqueue({id:'a',placeId,kind:'create',data:{title:'Test'}}),b.enqueue({id:'b',placeId,kind:'upload',blob:new Blob(['saved image'],{type:'image/png'})})]);
  const third=await openStore();const jobs=await third.jobs();assert.equal(jobs.length,2);assert.deepEqual(jobs.map(j=>j.order),[1,2]);assert.equal(await jobs.find(j=>j.id==='b').blob.text(),'saved image');
  await third.snapshot({places:[{id:placeId,title:'Cloud record'}],version:2,etag:'2'},['a']);assert.equal((await a.jobs()).length,1);assert.equal((await b.records())[0].title,'Cloud record');
});
test('IndexedDB rejects stale snapshots but acknowledges jobs atomically',async()=>{
  globalThis.indexedDB=new IDBFactory();const s=await openStore();await s.enqueue({id:'job',placeId:'x',kind:'patch',data:{title:'New'}});
  await s.snapshot({places:[{id:'x',title:'New'}],version:10,etag:'10'},['job']);await s.snapshot({places:[{id:'x',title:'Old'}],version:9,etag:'9'});
  assert.equal((await s.records())[0].title,'New');assert.equal(await s.meta('version'),10);assert.equal((await s.jobs()).length,0);
});
test('discarding a failed create removes only its dependent jobs',async()=>{
  globalThis.indexedDB=new IDBFactory();const s=await openStore();await s.enqueue({id:'create',placeId:'x',kind:'create'});await s.enqueue({id:'upload',placeId:'x',kind:'upload'});await s.enqueue({id:'other',placeId:'y',kind:'patch'});
  await s.updateJob('create',{error:'Cannot create'});assert.equal((await s.jobs())[0].error,'Cannot create');await s.discard('create');assert.deepEqual((await s.jobs()).map(j=>j.id),['other']);
});
