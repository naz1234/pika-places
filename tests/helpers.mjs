import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../server/api.js';
export function testEnv(options={}) {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  const query=(sql,params=[])=>({
    bind(...args){return query(sql,args);},
    async first(column){const row=sqlite.prepare(sql).get(...params);return row ? (column ? row[column] : {...row}) : null;},
    async all(){return {results:sqlite.prepare(sql).all(...params).map(x=>({...x})),success:true};},
    async run(){const r=sqlite.prepare(sql).run(...params);return {success:true,meta:{changes:Number(r.changes)}};},
    _sql:sql,_params:params
  });
  const objects=new Map();
  const env={DB:{prepare:query,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const stmt of statements){const prepared=sqlite.prepare(stmt._sql);if(/^\s*SELECT/i.test(stmt._sql))results.push({results:prepared.all(...stmt._params).map(x=>({...x})),success:true,meta:{changes:0}});else{const r=prepared.run(...stmt._params);results.push({results:[],success:true,meta:{changes:Number(r.changes)}});}}sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}},MEDIA:{async put(key,bytes,metadata){objects.set(key,{bytes:Uint8Array.from(bytes),metadata});},async get(key,options){const o=objects.get(key);if(!o)return null;const r=options?.range;return {body:r?o.bytes.slice(r.offset,r.offset+r.length):o.bytes};},async delete(key){objects.delete(key);}},...options};
  return {env,sqlite,objects,close:()=>sqlite.close()};
}
export function api(env,path='/api/places',{method='GET',body,mutationId=crypto.randomUUID(),headers={}}={}) {
  const finalHeaders=method==='GET'||method==='HEAD'?headers:{'Content-Type':'application/json','X-Pika-Client':'1','X-Mutation-Id':mutationId,'Origin':'https://pika.test',...headers};
  return handleRequest(new Request(`https://pika.test${path}`,{method,headers:finalHeaders,body:body===undefined?undefined:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body)}),env);
}
export async function createPlace(env,place={title:'Klang café',area:'Klang',state:'Selangor'}){const id=crypto.randomUUID();const r=await api(env,'/api/places',{method:'POST',body:{id,place}});if(r.status!==200)throw new Error(await r.text());return id;}
export class MemoryStore {
  constructor(){this.data=[];this.outbox=[];this.metadata={};this.order=0;}
  async records(){return structuredClone(this.data);}
  async jobs(){return structuredClone(this.outbox).sort((a,b)=>a.order-b.order);}
  async meta(key){return this.metadata[key];}
  async enqueue(job){this.outbox.push({...structuredClone(job),order:++this.order});}
  async updateJob(id,patch){const job=this.outbox.find(j=>j.id===id);if(job)Object.assign(job,patch);}
  async discard(id){const job=this.outbox.find(j=>j.id===id);this.outbox=this.outbox.filter(j=>j.id!==id && !(job?.kind==='create'&&j.placeId===job.placeId));}
  async snapshot({places,version,etag},completed=[]){if(version>=(this.metadata.version||0)){this.data=structuredClone(places);this.metadata={...this.metadata,version,etag};}this.outbox=this.outbox.filter(j=>!completed.includes(j.id));}
}
