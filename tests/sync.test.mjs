import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore,testEnv } from './helpers.mjs';
import { handleRequest } from '../server/api.js';
import { SyncEngine } from '../public/js/sync.js';
import { matchPlace,projectPlaces,quickLocationFilter,sourceName,safeUrl,stateForTown,townSuggestions } from '../public/js/model.js';

const fetchFor=env=>(path,options={})=>handleRequest(new Request(`https://pika.test${path}`,options),env);
function enqueue(store,kind,placeId,data={}){return store.enqueue({id:crypto.randomUUID(),kind,placeId,createdAt:new Date().toISOString(),...data});}
test('two independent devices see cloud changes without login or local data sharing',async t=>{
  const f=testEnv();t.after(f.close);const a=new MemoryStore(),b=new MemoryStore();const first=new SyncEngine(a,{fetcher:fetchFor(f.env)}),second=new SyncEngine(b,{fetcher:fetchFor(f.env)});const id=crypto.randomUUID();
  await enqueue(a,'create',id,{data:{title:'Melaka café',state:'Melaka'}});await first.sync(true);assert.equal((await a.jobs()).length,0);
  await second.sync(true);assert.equal((await b.records())[0].title,'Melaka café');
  await enqueue(a,'patch',id,{data:{notes:'Breakfast'}});await enqueue(b,'patch',id,{data:{favourite:true}});await first.sync(true);await second.sync(true);await first.sync(true);
  assert.equal((await a.records())[0].favourite,true);assert.equal((await b.records())[0].notes,'Breakfast');assert.equal(first.state,'synced');
});
test('offline queue survives engine restart and retries on reconnect',async t=>{
  const f=testEnv();t.after(f.close);const store=new MemoryStore();const id=crypto.randomUUID();await enqueue(store,'create',id,{data:{title:'Johor stop',area:'Muar',state:'Johor'}});
  const offline=new SyncEngine(store,{fetcher:async()=>{throw new Error('Offline');}});await offline.sync(true);assert.equal((await store.jobs()).length,1);assert.equal((await offline.view())[0].pending,true);
  const connected=new SyncEngine(store,{fetcher:fetchFor(f.env)});await connected.sync(true);assert.equal((await store.jobs()).length,0);assert.equal((await store.records())[0].title,'Johor stop');
});
test('lost write response retains the job; retry is idempotent',async t=>{
  const f=testEnv();t.after(f.close);const store=new MemoryStore();await enqueue(store,'create',crypto.randomUUID(),{data:{title:'One place only'}});let failed=false;
  const engine=new SyncEngine(store,{fetcher:async(path,options)=>{const r=await fetchFor(f.env)(path,options);if(options?.method==='POST'&&!failed){failed=true;throw new Error('Response lost');}return r;}});
  await engine.sync(true);assert.equal((await store.jobs()).length,1);await engine.sync(true);assert.equal((await store.jobs()).length,0);assert.equal((await store.records()).length,1);
});
test('acknowledged writes remain queued if the following snapshot fails',async t=>{
  const f=testEnv();t.after(f.close);const store=new MemoryStore();await enqueue(store,'create',crypto.randomUUID(),{data:{title:'Do not disappear'}});let fail=true;
  const engine=new SyncEngine(store,{fetcher:async(path,options)=>{if(!options.method&&fail)throw new Error('Read unavailable');return fetchFor(f.env)(path,options);}});
  await engine.sync(true);assert.equal((await store.jobs()).length,1);fail=false;await engine.sync(true);assert.equal((await store.jobs()).length,0);assert.equal((await store.records())[0].title,'Do not disappear');
});
test('a deleted place blocks stale offline patches and exposes the error for review',async t=>{
  const f=testEnv();t.after(f.close);const a=new MemoryStore(),b=new MemoryStore();const id=crypto.randomUUID();const ea=new SyncEngine(a,{fetcher:fetchFor(f.env)}),eb=new SyncEngine(b,{fetcher:fetchFor(f.env)});
  await enqueue(a,'create',id,{data:{title:'Do not resurrect'}});await ea.sync(true);await eb.sync(true);await enqueue(b,'patch',id,{data:{notes:'Old offline change'}});await enqueue(a,'trash',id);await ea.sync(true);await eb.sync(true);
  assert.equal(eb.state,'error');assert.ok((await b.jobs())[0].error);assert.ok((await b.records())[0].deleted_at);
});
test('snapshot version guard does not replace newer cloud records with older results',async()=>{
  const s=new MemoryStore();await s.snapshot({places:[{id:'1',title:'New'}],version:10,etag:'10'});await s.snapshot({places:[{id:'1',title:'Old'}],version:9,etag:'9'});assert.equal((await s.records())[0].title,'New');
});
test('Malaysia filtering and source recognition do not confuse lookalike domains',()=>{
  const p={title:'Breakfast',area:'Klang',state:'Selangor',notes:'Good roti',category:'Food',status:'want',collection:'Weekend'};
  assert.ok(matchPlace(p,{area:'Klang'}));assert.ok(matchPlace(p,{area:'Selangor',query:'roti'}));assert.ok(!matchPlace(p,{area:'Johor'}));assert.ok(matchPlace(p,{collection:'Weekend'}));assert.ok(!matchPlace(p,{collection:'Other'}));assert.equal(sourceName('https://tiktok.com.evil.test'),'Link');assert.equal(safeUrl('javascript:alert(1)'),'');
});
test('quick location filters keep state dropdown and area chips in sync',()=>{
  assert.deepEqual(quickLocationFilter('Johor'),{state:'Johor',area:''});
  assert.deepEqual(quickLocationFilter('Melaka'),{state:'Melaka',area:''});
  assert.deepEqual(quickLocationFilter('Klang'),{state:'',area:'Klang'});
  assert.deepEqual(quickLocationFilter(''),{state:'',area:''});
});
test('town suggestions follow the selected state and include saved custom towns',()=>{
  const places = [
    {state:'Johor',area:'Kulai'},
    {state:'Johor',area:'  muar  '},
    {state:'Selangor',area:'Petaling Jaya'},
    {state:'',area:'Unassigned town'},
    {state:'Johor',area:'Kluang',deleted_at:'2026-01-01'}
  ];
  assert.deepEqual(townSuggestions('Johor',places),['Johor Bahru','Muar','Batu Pahat','Kulai']);
  assert.deepEqual(townSuggestions('Melaka',places),['Melaka City','Ayer Keroh']);
  assert.ok(!townSuggestions('Johor',places).includes('Klang'));
  assert.ok(townSuggestions('',places).includes('Petaling Jaya'));
  assert.ok(townSuggestions('',places).includes('Unassigned town'));
});
test('known town suggestions can infer a state without overriding unknown towns',()=>{
  const places = [
    {state:'Johor',area:'Kulai'},
    {state:'Johor',area:'Shared'},
    {state:'Selangor',area:'Shared'}
  ];
  assert.equal(stateForTown('Johor Bahru'),'Johor');
  assert.equal(stateForTown('  Klang  '),'Selangor');
  assert.equal(stateForTown('kulai',places),'Johor');
  assert.equal(stateForTown('Shared',places),'');
  assert.equal(stateForTown('My custom town',places),'');
  assert.equal(stateForTown('',[{state:'Johor',area:''}]),'');
});
test('outbox projection never resurrects a tombstone with a pending edit',()=>{
  const projected=projectPlaces([{id:'x',title:'Gone',deleted_at:'2026-01-01',media:[]}],[{id:'j',placeId:'x',kind:'patch',order:1,data:{title:'Stale'}}]);assert.equal(projected[0].title,'Gone');assert.ok(projected[0].deleted_at);
});
