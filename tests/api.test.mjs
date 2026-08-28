import test from 'node:test';
import assert from 'node:assert/strict';
import { api,createPlace,testEnv } from './helpers.mjs';
import { detectMedia,parseRange,validateChanges } from '../server/api.js';
const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,1,2,3,4,5,6,7]);

test('shared CRUD, per-field patches, revision, and ETag polling',async t=>{
  const f=testEnv();t.after(f.close);const id=await createPlace(f.env);
  const a=await api(f.env);assert.equal(a.status,200);const etag=a.headers.get('etag');const data=await a.json();assert.equal(data.places[0].area,'Klang');
  assert.equal((await api(f.env,'/api/places',{headers:{'if-none-match':etag}})).status,304);
  await api(f.env,`/api/places/${id}`,{method:'PATCH',body:{changes:{notes:'Try breakfast'}}});
  await api(f.env,`/api/places/${id}`,{method:'PATCH',body:{changes:{favourite:true}}});
  const fresh=await (await api(f.env)).json();assert.equal(fresh.places[0].notes,'Try breakfast');assert.equal(fresh.places[0].favourite,true);assert.equal(fresh.places[0].revision,3);
});
test('replayed mutations cannot overwrite a newer update',async t=>{
  const f=testEnv();t.after(f.close);const id=await createPlace(f.env);const mutationId=crypto.randomUUID();const path=`/api/places/${id}`;
  const original={method:'PATCH',mutationId,body:{changes:{notes:'Old note'}}};await api(f.env,path,original);
  await api(f.env,path,{method:'PATCH',body:{changes:{notes:'New note'}}});assert.equal((await api(f.env,path,original)).status,200);
  assert.equal((await (await api(f.env)).json()).places[0].notes,'New note');
  assert.equal((await api(f.env,path,{...original,body:{changes:{notes:'Different payload'}}})).status,409);
});
test('public trash is recoverable and stale offline edits do not resurrect places',async t=>{
  const f=testEnv();t.after(f.close);const id=await createPlace(f.env);
  assert.equal((await api(f.env,`/api/places/${id}/trash`,{method:'POST',body:{}})).status,200);
  const blocked=await api(f.env,`/api/places/${id}`,{method:'PATCH',body:{changes:{title:'Stale title'}}});assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'place_deleted');
  assert.equal((await api(f.env,`/api/places/${id}/restore`,{method:'POST',body:{}})).status,200);
  assert.equal((await (await api(f.env)).json()).places[0].deleted_at,null);
});
test('screenshot copy persists independently of a source link and supports ranges',async t=>{
  const f=testEnv();t.after(f.close);const place=await createPlace(f.env,{title:'Saved screenshot',source_url:'https://www.facebook.com/example/post'});const media=crypto.randomUUID();
  const upload=()=>api(f.env,`/api/places/${place}/media/${media}`,{method:'PUT',body:png,headers:{'Content-Type':'image/png','X-File-Name':'my%20image.png'}});
  assert.equal((await upload()).status,201);assert.equal((await upload()).status,200);assert.equal(f.objects.size,1);
  await api(f.env,`/api/places/${place}`,{method:'PATCH',body:{changes:{source_url:''}}});
  const r=await api(f.env,`/api/media/${media}`,{headers:{Range:'bytes=2-5'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),'bytes 2-5/16');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png.slice(2,6));
  const head=await api(f.env,`/api/media/${media}`,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'16');
  assert.equal((await api(f.env,`/api/media/${media}`,{headers:{Range:'bytes=100-200'}})).status,416);
  await api(f.env,`/api/places/${place}/trash`,{method:'POST',body:{}});assert.equal((await api(f.env,`/api/media/${media}`)).status,404);
  await api(f.env,`/api/places/${place}/restore`,{method:'POST',body:{}});assert.equal((await api(f.env,`/api/media/${media}`)).status,200);
});
test('rejects executable uploads, cross-origin writes, unknown fields and unsafe URLs',async t=>{
  const f=testEnv();t.after(f.close);const id=await createPlace(f.env);
  assert.equal((await api(f.env,`/api/places/${id}/media/${crypto.randomUUID()}`,{method:'PUT',body:'<svg onload="alert(1)"></svg>',headers:{'Content-Type':'image/png'}})).status,415);
  assert.equal((await api(f.env,`/api/places/${id}`,{method:'PATCH',body:{changes:{notes:'Bad'}},headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await api(f.env,`/api/places/${id}`,{method:'PATCH',body:{changes:{source_url:'javascript:alert(1)'}}})).status,400);
  assert.throws(()=>validateChanges({deleted_at:null}));assert.throws(()=>validateChanges({state:'Japan'}));assert.throws(()=>validateChanges({favourite:'yes'}));
});
test('storage limits and missing bindings produce explicit failures, not fake success',async t=>{
  const f=testEnv({MAX_PLACES:'1',WRITES_PER_MINUTE:'600'});t.after(f.close);const id=await createPlace(f.env);
  assert.equal((await api(f.env,'/api/places',{method:'POST',body:{id:crypto.randomUUID(),place:{title:'Too many'}}})).status,409);
  assert.equal((await api({...f.env,MEDIA:undefined},`/api/places/${id}/media/${crypto.randomUUID()}`,{method:'PUT',body:png})).status,503);
  assert.equal((await api({},'/api/health')).status,503);
  assert.equal((await api({...f.env,MAX_STORAGE_MB:'1'},`/api/places/${id}/media/${crypto.randomUUID()}`,{method:'PUT',body:new Uint8Array([...png,...new Uint8Array(1024*1024)])})).status,409);
});
test('file removal advances version, hides the file, and retains bytes for owner recovery',async t=>{
  const f=testEnv();t.after(f.close);const id=await createPlace(f.env);const media=crypto.randomUUID();
  await api(f.env,`/api/places/${id}/media/${media}`,{method:'PUT',body:png});
  const before=await (await api(f.env)).json();
  const r=await api(f.env,`/api/places/${id}/remove-media/${media}`,{method:'POST',body:{}});assert.equal(r.status,200);
  const after=await (await api(f.env)).json();assert.ok(after.version>before.version);assert.equal(after.places[0].media.length,0);assert.equal(f.objects.size,1);assert.equal((await api(f.env,`/api/media/${media}`)).status,404);
});
test('range parsing and media signatures',()=>{
  assert.deepEqual(parseRange('bytes=-4',10),{offset:6,length:4});assert.deepEqual(parseRange('bytes=2-',10),{offset:2,length:8});assert.throws(()=>parseRange('bytes=0-2,5-6',10));assert.throws(()=>parseRange('bytes=-0',10));
  assert.equal(detectMedia(png),'image/png');assert.throws(()=>detectMedia(new TextEncoder().encode('<html>')));
});
test('rate limiting is shared by the database across independent requests',async t=>{
  const f=testEnv({WRITES_PER_MINUTE:'1'});t.after(f.close);const id=await createPlace(f.env);
  const r=await api(f.env,`/api/places/${id}`,{method:'PATCH',body:{changes:{notes:'Wait'}}});assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
});
test('identical concurrent creates acknowledge one shared record',async t=>{
  const f=testEnv();t.after(f.close);const id=crypto.randomUUID(),mutationId=crypto.randomUUID();
  const options={method:'POST',mutationId,body:{id,place:{title:'Same queued change'}}};
  const responses=await Promise.all([api(f.env,'/api/places',options),api(f.env,'/api/places',options)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.equal((await (await api(f.env)).json()).places.length,1);
});
test('an R2 write failure is not labelled saved and removes the pending reservation',async t=>{
  const f=testEnv();t.after(f.close);const id=await createPlace(f.env),media=crypto.randomUUID();
  const broken={...f.env,MEDIA:{...f.env.MEDIA,async put(){throw new Error('Simulated storage failure');}}};
  const r=await api(broken,`/api/places/${id}/media/${media}`,{method:'PUT',body:png});assert.equal(r.status,500);
  assert.equal((await (await api(f.env)).json()).places[0].media.length,0);
  assert.equal(f.sqlite.prepare('SELECT count(*) as n FROM media').get().n,0);
});
