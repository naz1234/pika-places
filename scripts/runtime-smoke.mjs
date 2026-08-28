// Local workerd/Miniflare API check: no Cloudflare account or external network calls.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.build/index.js',compatibilityDate:'2026-08-28',d1Databases:{DB:'pika-smoke-db'},r2Buckets:['MEDIA'],serviceBindings:{ASSETS:()=>new Response('Static fallback')},outboundService:()=>new Response('External networking disabled',{status:403})}));
try {
  const db=await mf.getD1Database('DB');
  const schema=await readFile('migrations/0001_initial.sql','utf8');
  for(const sql of schema.split(/;\s*\n/).map(s=>s.trim()).filter(Boolean)) await db.prepare(sql).run();
  const send=(path,options={})=>mf.dispatchFetch(`https://pika.test${path}`,options);
  const mutate=(path,body,method='POST',extra={})=>send(path,{method,headers:{'Content-Type':'application/json','X-Pika-Client':'1','X-Mutation-Id':crypto.randomUUID(),Origin:'https://pika.test',...extra},body:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body)});
  const health=await send('/api/health');assert.equal(health.status,200);assert.equal((await health.json()).media,true);
  const id=crypto.randomUUID();let r=await mutate('/api/places',{id,place:{title:'Local runtime test',state:'Melaka',area:'Ayer Keroh'}});assert.equal(r.status,200,await r.text());
  const secondDevice=await send('/api/places');let snapshot=await secondDevice.json();assert.equal(snapshot.places[0].title,'Local runtime test');
  r=await mutate(`/api/places/${id}`,{changes:{notes:'Seen from the second client'}},'PATCH');assert.equal(r.status,200,await r.text());
  const mediaId=crypto.randomUUID(),bytes=await readFile('public/assets/icon-192.png');
  r=await mutate(`/api/places/${id}/media/${mediaId}`,bytes,'PUT',{'Content-Type':'image/png','X-File-Name':'test.png'});assert.equal(r.status,201,await r.text());
  r=await send(`/api/media/${mediaId}`,{headers:{Range:'bytes=0-7'}});assert.equal(r.status,206);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),new Uint8Array(bytes.slice(0,8)));
  r=await mutate(`/api/places/${id}/trash`,{});assert.equal(r.status,200,await r.text());assert.equal((await send(`/api/media/${mediaId}`)).status,404);
  r=await mutate(`/api/places/${id}/restore`,{});assert.equal(r.status,200,await r.text());assert.equal((await send(`/api/media/${mediaId}`)).status,200);
  console.log('PASS: local Cloudflare runtime health, shared reads, field updates, real PNG upload, range read, trash and restore.');
} finally { await mf.dispose(); }
