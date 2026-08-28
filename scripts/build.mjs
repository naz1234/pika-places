import { readFile, readdir, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
async function files(dir) { const result=[]; for(const entry of await readdir(dir,{withFileTypes:true})) { const path=`${dir}/${entry.name}`; if(entry.isDirectory()) result.push(...await files(path));else result.push(path); }return result; }
for(const root of ['public','server','functions','scripts']) for(const file of await files(root)) if(/\.(js|mjs)$/.test(file)) {
  const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(check.status!==0)throw new Error(check.stderr);
}
const html=await readFile('public/index.html','utf8');
for(const match of html.matchAll(/(?:src|href)="(\/(?!\/)[^"#]+)"/g)) await readFile(`public${match[1]}`);
const manifest=JSON.parse(await readFile('public/manifest.webmanifest','utf8'));
for(const icon of manifest.icons) await readFile(`public${icon.src}`);
const routes=JSON.parse(await readFile('public/_routes.json','utf8'));
if(!routes.include.includes('/api/*'))throw new Error('Missing API routes.');
await mkdir('.build',{recursive:true});
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
const build=spawnSync(process.execPath,[wrangler,'pages','functions','build','functions','--outdir','.build','--compatibility-date','2026-08-28'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(build.status!==0)process.exit(build.status||1);
console.log('Production checks passed. Static output: public/; Pages Functions compiled successfully.');
