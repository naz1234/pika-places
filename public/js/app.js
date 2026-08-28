import { CATEGORIES, DEFAULT_PLACE, MAX_FILE_BYTES, STATES, mapLink, matchPlace, safeUrl, sourceName } from './model.js';
import { openStore } from './store.js';
import { SyncEngine } from './sync.js';

const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const make = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; };
const icon = name => { const el = document.createElementNS(svgNS, 'svg'); el.setAttribute('class', 'icon'); el.setAttribute('aria-hidden', 'true'); const use = document.createElementNS(svgNS, 'use'); use.setAttribute('href', `#i-${name}`); el.append(use); return el; };
function button(text, cls, action, iconName) { const b = make('button', cls); b.type = 'button'; if (iconName) b.append(icon(iconName)); if (text) b.append(document.createTextNode(text)); if (action) b.addEventListener('click', action); return b; }
function external(text, url, iconName) { const a = make('a', '', text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; if (iconName) a.prepend(icon(iconName)); return a; }
const filters = { query: '', area: '', category: '', status: '', state: '', collection: '', view: 'saved' };
let records = [], jobs = [], store, engine, editor = null, editorTimer, editorChain = Promise.resolve(), uploadsInProgress = 0, toastTimer;
const blobUrls = new Map();
const visitNames = { want: 'Want to visit', planned: 'Planned', visited: 'Visited' };
const categoryIcons = { Food: 'pin', 'Café': 'pin', Stay: 'trip', Shopping: 'bookmark', Activity: 'pin', Nature: 'pin', Other: 'bookmark' };
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
function showError(error) { toast(error.message || 'Something went wrong. Please try again.'); }
function mediaUrl(media) {
  if (!media.pending) return `/api/media/${media.id}`;
  if (!blobUrls.has(media.id)) blobUrls.set(media.id, URL.createObjectURL(media.blob));
  return blobUrls.get(media.id);
}
function fillOptions(select, values) { for (const value of values) select.append(new Option(value, value)); }
fillOptions($('state-filter'), STATES); fillOptions($('category-filter'), CATEGORIES);
fillOptions($('place-form').elements.state, STATES); fillOptions($('place-form').elements.category, CATEGORIES);

function renderAreas() {
  const selected = filters.area;
  const all = [...new Set(['Melaka', 'Johor', 'Klang', ...records.filter(p => !p.deleted_at).flatMap(p => [p.state, p.area]).filter(Boolean)])];
  const root = $('area-filters'); const scroll = root.scrollLeft; root.replaceChildren();
  for (const value of ['', ...all]) {
    const b = button(value || 'All', 'area-chip', () => { filters.area = value; filters.state = ''; $('state-filter').value = ''; render(); });
    b.setAttribute('aria-pressed', String(selected === value)); root.append(b);
  }
  root.scrollLeft = scroll;
}
function clearFilters() {
  Object.assign(filters, { query: '', area: '', category: '', status: '', state: '', collection: '' });
  for (const key of ['search', 'state-filter', 'category-filter', 'status-filter']) $(key).value = '';
  render();
}
function changeView(view) { filters.view = view; clearFilters(); }
function photoFallback(cover, text, symbol) { const p = make('div', 'cover-placeholder'); p.append(icon(symbol), make('span', '', text)); cover.append(p); }
function placeCard(place) {
  const article = make('article', 'place-card'); const cover = make('div', 'card-cover');
  const photo = place.media.find(m => m.content_type.startsWith('image/'));
  if (photo) {
    const image = make('img'); image.src = mediaUrl(photo); image.alt = `Saved image for ${place.title}`; image.loading = 'lazy'; image.decoding = 'async';
    image.addEventListener('error', () => { image.remove(); photoFallback(cover, 'Image unavailable offline', 'photo'); }, { once: true }); cover.append(image);
  } else photoFallback(cover, place.media.some(m => m.content_type.startsWith('video/')) ? 'Video saved' : 'Your next little detour', place.media.some(m => m.content_type.startsWith('video/')) ? 'play' : categoryIcons[place.category] || 'pin');
  const open = button('', 'cover-open', () => openEditor(place.id)); open.setAttribute('aria-label', `Open ${place.title}`); cover.append(open);
  cover.append(make('span', 'source-badge', place.source_url ? sourceName(place.source_url) : (place.media.length ? 'Upload' : 'Saved place')));
  if (!place.deleted_at) { const fav = button('', 'favourite-button', () => void engine.enqueue('patch', place.id, { data: { favourite: !place.favourite } }).catch(showError), 'star'); fav.setAttribute('aria-label', `${place.favourite ? 'Unfavourite' : 'Favourite'} ${place.title}`); fav.setAttribute('aria-pressed', String(place.favourite)); cover.append(fav); }
  const body = make('div', 'card-body'); body.append(button(place.title, 'card-title', () => openEditor(place.id)));
  const location = [...new Set([place.area, place.state].filter(Boolean))].join(', ');
  body.append(make('p', 'card-location', location || (place.map_url ? 'Map location saved' : 'Location to confirm')));
  const savedFiles = place.media.filter(m => !m.pending);
  let label = savedFiles.some(m => m.content_type.startsWith('video/')) ? 'Video saved' : savedFiles.length ? 'Screenshot / photo saved' : 'Link / details only';
  let labelClass = 'backup-label' + (!savedFiles.length ? ' warning' : '');
  if (place.pending) { label = 'Changes waiting to sync'; labelClass = 'backup-label warning'; }
  if (place.syncError) { label = 'Sync needs attention'; labelClass = 'backup-label failed'; }
  body.append(make('span', labelClass, label));
  body.append(make('p', 'card-note', place.notes || (place.collection ? `Trip: ${place.collection}` : 'Add a note about this place.')));
  const links = make('div', 'card-links');
  if (place.deleted_at) links.append(button('Restore', '', () => void engine.enqueue('restore', place.id).catch(showError), 'refresh'));
  else {
    if (safeUrl(place.source_url)) links.append(external('Original post', safeUrl(place.source_url), 'link'));
    if (place.map_url || place.state || place.area) links.append(external(place.map_url ? 'Open map' : 'Find map', mapLink(place), 'pin'));
    else links.append(button('Add location', '', () => openEditor(place.id), 'pin'));
  }
  body.append(links);
  const visit = make('div', 'card-visit'); visit.append(icon(place.status === 'visited' ? 'check' : 'bookmark'), document.createTextNode(`${place.category} · ${visitNames[place.status] || 'Want to visit'}`)); body.append(visit);
  article.append(cover, body); return article;
}
function render() {
  renderAreas();
  const pendingIds = new Set(records.flatMap(p => p.media.filter(m => m.pending).map(m => m.id)));
  for (const [key, value] of blobUrls) if (!pendingIds.has(key)) { URL.revokeObjectURL(value); blobUrls.delete(key); }
  for (const b of document.querySelectorAll('[data-view]')) { if (b.dataset.view === filters.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  const titles = { saved: 'Saved inspiration', favourites: 'The favourites', trips: 'Little trips, good finds', trash: 'Trash' };
  $('view-title').textContent = titles[filters.view]; $('browse-controls').hidden = filters.view === 'trips';
  $('clear-filters').hidden = !['query', 'area', 'state', 'category', 'status', 'collection'].some(k => filters[k]);
  $('collection-filter').hidden = !filters.collection; $('collection-filter').textContent = `Trip: ${filters.collection}`;
  const grid = $('place-grid'); grid.replaceChildren();
  let visible;
  if (filters.view === 'trips') {
    const groups = new Map();
    for (const p of records.filter(p => !p.deleted_at && p.collection)) { if (!groups.has(p.collection)) groups.set(p.collection, []); groups.get(p.collection).push(p); }
    for (const [title, places] of groups) { const b = button('', 'trip-card', () => { filters.view = 'saved'; filters.collection = title; render(); }); b.append(icon('trip'), make('h3', '', title), make('p', '', `${places.length} saved place${places.length === 1 ? '' : 's'} · ${[...new Set(places.map(p => p.state).filter(Boolean))].join(', ') || 'Malaysia'}`)); grid.append(b); }
    visible = [...groups]; $('result-count').textContent = `${groups.size} collection${groups.size === 1 ? '' : 's'}`;
  } else {
    visible = records.filter(p => matchPlace(p, filters) && (!filters.state || p.state === filters.state));
    for (const place of visible) grid.append(placeCard(place));
    $('result-count').textContent = `${visible.length} place${visible.length === 1 ? '' : 's'}${jobs.length ? ` · ${jobs.length} pending change${jobs.length === 1 ? '' : 's'}` : ''}`;
  }
  $('empty-state').hidden = visible.length > 0;
  const isFiltered = ['query','area','category','state','status','collection'].some(k => filters[k]);
  let title = 'Your next good find goes here.', copy = 'That café in Melaka. A food stop in Klang. Keep the post, add a screenshot, and find it when you’re nearby.';
  if (isFiltered) { title = 'No places match just yet.'; copy = 'Try a different area, category or search.'; }
  else if (filters.view === 'favourites') { title = 'Keep the best ones close.'; copy = 'Tap the star on a saved place to find it here.'; }
  else if (filters.view === 'trips') { title = 'A few good stops make a trip.'; copy = 'Open a place and give it a Trip / collection name, such as “Melaka weekend”. Places with the same name stay together.'; }
  else if (filters.view === 'trash') { title = 'Nothing in Trash.'; copy = 'Places moved to Trash can be restored here. Only the owner can permanently clean up storage.'; }
  $('empty-title').textContent = title; $('empty-copy').textContent = copy;
  $('empty-add').hidden = isFiltered || filters.view !== 'saved';
  renderEditorMedia(); renderPending();
  const trips = [...new Set(records.map(p => p.collection).filter(Boolean))]; $('trip-suggestions').replaceChildren(...trips.map(t => new Option(t, t)));
}
function captureDraft() {
  if (!editor) return {};
  const result = {};
  for (const key of Object.keys(DEFAULT_PLACE)) { const field = $('place-form').elements[key]; result[key] = key === 'favourite' ? field.checked : field.value.trim(); }
  return result;
}
function showFormError(message) { $('form-error').textContent = message || ''; $('form-error').hidden = !message; }
async function persistDraft(target) {
  if (!target || editor !== target || target.readonly) return true;
  const data = captureDraft();
  for (const field of ['source_url','map_url']) if (data[field] && !safeUrl(data[field])) { $('editor-save-status').textContent = 'Finish the link to save'; showFormError('Use a complete link starting with https:// or http://.'); return false; }
  showFormError('');
  const meaningful = !!(data.title || data.source_url || data.notes || data.area || data.state || data.map_url || target.forceCreate);
  if (!target.exists && !meaningful) return true;
  if (!data.title) data.title = data.source_url ? `Place from ${sourceName(data.source_url)}` : 'Saved place';
  const changes = Object.fromEntries(Object.entries(data).filter(([key, value]) => value !== target.last[key]));
  if (target.exists && !Object.keys(changes).length) return true;
  $('editor-save-status').textContent = 'Keeping your changes…';
  try {
    if (!target.exists) { await engine.enqueue('create', target.id, { data }); target.exists = true; }
    else await engine.enqueue('patch', target.id, { data: changes });
    target.last = { ...data };
    if (editor === target && !$('place-form').elements.title.value.trim()) $('place-form').elements.title.value = data.title;
    if (editor === target) $('editor-save-status').textContent = engine.state === 'synced' ? 'Up to date' : 'Changes kept · syncing automatically';
    return true;
  } catch (error) { if (editor === target) { showFormError(`Could not keep this change: ${error.message}. Do not close this form yet.`); $('editor-save-status').textContent = 'Not saved'; } return false; }
}
function saveEditor() { const target = editor; clearTimeout(editorTimer); const result = editorChain.then(() => persistDraft(target)); editorChain = result.catch(() => {}); return result; }
function scheduleSave() {
  $('editor-save-status').textContent = 'Editing…'; clearTimeout(editorTimer); editorTimer = setTimeout(() => void saveEditor(), 650);
}
function openEditor(placeId = null) {
  const place = records.find(p => p.id === placeId);
  editor = { id: place?.id || crypto.randomUUID(), exists: !!place, last: Object.fromEntries(Object.keys(DEFAULT_PLACE).map(k => [k, place?.[k] ?? DEFAULT_PLACE[k]])), mediaSignature: '', readonly: !!place?.deleted_at };
  $('place-form').reset();
  for (const [key,value] of Object.entries(editor.last)) { const field = $('place-form').elements[key]; if (key === 'favourite') field.checked = value; else field.value = value; }
  $('editor-title').textContent = place?.deleted_at ? 'Place in Trash' : place ? 'Your saved place' : 'Save a place';
  $('editor-save-status').textContent = place?.deleted_at ? 'Restore from Trash before editing' : 'Details save automatically';
  $('trash-place').hidden = !place || !!place.deleted_at; showFormError('');
  for (const el of $('place-form').elements) el.disabled = !!place?.deleted_at && el.type !== 'submit';
  renderEditorMedia(true); $('editor').showModal();
  // Avoid opening the keyboard automatically when reviewing an existing place.
  $('close-editor').focus({ preventScroll: true });
}
async function closeEditor() {
  if (uploadsInProgress) { toast('Please wait while the selected files are prepared.'); return; }
  if (!await saveEditor()) return;
  $('editor').close(); editor = null;
}
function renderEditorMedia(force = false) {
  if (!editor) return;
  const place = records.find(p => p.id === editor.id); const media = place?.media || [];
  const signature = media.map(m => `${m.id}:${!!m.pending}`).join('|');
  if (!force && editor.mediaSignature === signature) return;
  editor.mediaSignature = signature; const gallery = $('editor-media'); gallery.replaceChildren();
  for (const m of media) {
    const wrapper = make('div','media-item');
    const asset = make(m.content_type.startsWith('video/') ? 'video' : 'img'); asset.src = mediaUrl(m);
    if (asset.tagName === 'VIDEO') { asset.controls = true; asset.playsInline = true; asset.preload = 'metadata'; }
    else { asset.alt = m.name || 'Saved screenshot'; asset.loading = 'lazy'; }
    asset.addEventListener('error', () => { const note = make('p','image-error','Media needs a connection. Video playback also depends on its codec.'); wrapper.prepend(note); }, { once:true });
    const actions = make('div','media-actions'); actions.append(make('span','',m.pending ? 'Upload waiting' : 'Copy saved'));
    if (!editor.readonly) actions.append(button('Remove','',async () => {
      try {
        if (m.pending) { const job = jobs.find(j => j.kind === 'upload' && j.mediaId === m.id); if (engine.running) return toast('Wait for the current sync before removing a pending file.'); if (job) await store.discard(job.id); await engine.notify(); }
        else await engine.enqueue('remove-media', editor.id, { mediaId:m.id });
      } catch(error) { showError(error); }
    }));
    wrapper.append(asset,actions); gallery.append(wrapper);
  }
}
async function prepareFile(file) {
  if (!file.type.startsWith('image/')) { if (file.size > MAX_FILE_BYTES) throw new Error('Videos must be 25 MB or smaller.'); return file; }
  if (file.size > 40 * 1024 * 1024) throw new Error('Choose an image smaller than 40 MB.');
  // Re-encode image pixels to remove metadata and reduce storage. Never send SVG as active content.
  if (file.type === 'image/svg+xml') throw new Error('Use a screenshot or a JPEG, PNG or WebP image. SVG is not supported.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve,reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('This image cannot be opened here. Please upload a screenshot, JPEG or PNG.')); img.src = url; });
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth,image.naturalHeight)); const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(image.naturalHeight*scale));
    const context = canvas.getContext('2d'); context.fillStyle='#ffffff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,canvas.width,canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.88));
    if (!blob) throw new Error('Image preparation failed. Please try a smaller screenshot.');
    return new File([blob], file.name.replace(/\.[^.]+$/,'')+'.jpg', {type:'image/jpeg'});
  } finally { URL.revokeObjectURL(url); }
}
async function addFiles(files) {
  if (!editor || !files.length) return;
  const target = editor; const current = records.find(p=>p.id===target.id)?.media.length || 0;
  if (files.length+current>8) return toast('Keep up to 8 files per place.');
  target.forceCreate=true; uploadsInProgress++;
  try {
    if (!await saveEditor()) return;
    for (const original of files) {
      $('editor-save-status').textContent='Preparing your file…';
      const file=await prepareFile(original);
      await engine.enqueue('upload',target.id,{mediaId:crypto.randomUUID(),blob:file,name:file.name});
    }
    $('editor-save-status').textContent='Files queued · keep open until synced';
  } catch(error) { showFormError(error.message); }
  finally { uploadsInProgress--; $('file-input').value=''; }
}
function renderPending() {
  $('sync-detail').textContent=engine?.message || 'Connecting…'; const root=$('pending-list'); root.replaceChildren();
  if (!jobs.length) root.append(make('p','field-help','No pending changes on this device.'));
  for (const job of jobs) {
    const row=make('div','pending-job'); const place=records.find(p=>p.id===job.placeId);
    row.append(make('strong','',`${place?.title || 'Saved place'} · ${job.kind==='upload' ? 'media upload' : job.kind}`));
    if(job.error) { row.append(make('p','',job.error)); row.append(button('Discard this pending change','',async()=>{ if(engine.running) return toast('Wait for the current sync to finish.'); await store.discard(job.id); await engine.notify(); void engine.sync(true); })); }
    root.append(row);
  }
}
function statusChanged({state,message}) {
  $('sync-button').dataset.state=state;
  $('sync-label').textContent=({synced:'Up to date',syncing:'Syncing',pending:'Pending',offline:'Not synced',error:'Check sync',checking:'Connecting'})[state] || 'Connecting';
  $('sync-button').setAttribute('aria-label',`Sync status: ${message}`); $('sync-detail').textContent=message;
  if(state==='synced') { $('setup-banner').hidden=true; if(editor && !uploadsInProgress && !hasUnsavedForm()) $('editor-save-status').textContent='Up to date'; }
}
async function checkHealth() {
  try { const r=await fetch('/api/health',{cache:'no-store',signal:AbortSignal.timeout(15000)}); const data=await r.json(); $('setup-banner').hidden=!!data.database; $('storage-banner').hidden=!!data.media || !data.database; }
  catch { /* Offline is already explained by the sync indicator. */ }
}
function hasUnsavedForm() {
  if(!editor || editor.readonly) return false;
  const draft=captureDraft();
  return Object.keys(DEFAULT_PLACE).some(key=>draft[key]!==editor.last[key]);
}

$('search').addEventListener('input',e=>{filters.query=e.target.value;render();});
for(const [id,key] of [['state-filter','state'],['category-filter','category'],['status-filter','status']]) $(id).addEventListener('change',e=>{filters[key]=e.target.value;if(key==='state') filters.area='';render();});
$('clear-filters').addEventListener('click',clearFilters);
for(const b of document.querySelectorAll('[data-view]')) b.addEventListener('click',()=>changeView(b.dataset.view));
for(const id of ['add-button','empty-add']) $(id).addEventListener('click',()=>{if(engine) openEditor();else toast('Device storage is not ready.');});
$('settings-button').addEventListener('click',()=>$('settings').showModal());
$('sync-button').addEventListener('click',()=>{renderPending();$('sync-dialog').showModal();});
for(const b of document.querySelectorAll('[data-close]')) b.addEventListener('click',()=>$(b.dataset.close).close());
$('close-editor').addEventListener('click',()=>void closeEditor());
$('editor').addEventListener('cancel',e=>{e.preventDefault();void closeEditor();});
$('place-form').addEventListener('submit',e=>{e.preventDefault();void closeEditor();});
$('place-form').addEventListener('input',e=>{if(Object.hasOwn(DEFAULT_PLACE,e.target.name)) scheduleSave();});
$('place-form').elements.area.addEventListener('change',e=>{
  const states={'klang':'Selangor','shah alam':'Selangor','melaka city':'Melaka','ayer keroh':'Melaka','johor bahru':'Johor','muar':'Johor','batu pahat':'Johor','kuala lumpur':'Kuala Lumpur'};
  if(!$('place-form').elements.state.value && states[e.target.value.trim().toLowerCase()]) {$('place-form').elements.state.value=states[e.target.value.trim().toLowerCase()];scheduleSave();}
});
$('file-input').addEventListener('change',e=>void addFiles([...e.target.files]));
$('trash-place').addEventListener('click',async()=>{if(!await saveEditor()) return; $('confirm-dialog').showModal();});
$('cancel-trash').addEventListener('click',()=>$('confirm-dialog').close());
$('confirm-trash').addEventListener('click',async()=>{
  if(!editor) return;
  try { await engine.enqueue('trash',editor.id); $('confirm-dialog').close();$('editor').close();editor=null;toast('Moved to Trash. You can restore it in Settings.'); }
  catch(error){showError(error);}
});
$('open-trash').addEventListener('click',()=>{$('settings').close();changeView('trash');});
$('retry-sync').addEventListener('click',async()=>{if(!engine)return; $('retry-sync').disabled=true;try{await engine.retry();await checkHealth();}finally{$('retry-sync').disabled=false;}});
$('export-data').addEventListener('click',()=>{
  const data={app:'Pika Places',version:1,exported_at:new Date().toISOString(),note:'Place details only. Media files and pending upload blobs are not included.',places:records.map(p=>({...p,media:p.media.map(({blob,...m})=>m)}))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=make('a');a.href=url;a.download=`pika-places-${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
window.addEventListener('online',()=>{void engine?.sync(true);void checkHealth();});
window.addEventListener('focus',()=>void engine?.sync());
document.addEventListener('visibilitychange',()=>{if(document.hidden)void saveEditor();else void engine?.sync(true);});
window.addEventListener('beforeunload',e=>{if(hasUnsavedForm()||uploadsInProgress){e.preventDefault();e.returnValue='';}});

async function start() {
  try {
    store=await openStore();const channel='BroadcastChannel' in window ? new BroadcastChannel('pika-places') : null;
    engine=new SyncEngine(store,{channel,onChange:(places,outbox)=>{records=places;jobs=outbox;render();},onStatus:statusChanged});
    if(channel) channel.onmessage=()=>void engine.notify();
    await engine.notify();void checkHealth();void engine.sync(true);
    setInterval(()=>{if(!document.hidden)void engine.sync();},5000);
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
  } catch(error) {
    $('result-count').textContent='Unable to start'; $('setup-banner').hidden=false; $('setup-banner').replaceChildren(make('strong','', 'Device storage unavailable'), make('p','',error.message));
    statusChanged({state:'error',message:error.message});
  }
}
void start();
