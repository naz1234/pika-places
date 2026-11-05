import { STATES, TOWNS_BY_STATE } from './locations.js';
export { STATES, STATE_LABELS, TOWNS_BY_STATE } from './locations.js';
export const CATEGORIES = ['Food', 'Café', 'Stay', 'Shopping', 'Activity', 'Nature', 'Other'];
export const STATUSES = ['want', 'planned', 'visited'];
export const DEFAULT_PLACE = { title: '', source_url: '', state: '', area: '', category: 'Food', map_url: '', notes: '', status: 'want', favourite: false, collection: '' };
export const FIELD_LIMITS = { title: 120, source_url: 2048, state: 60, area: 80, category: 24, map_url: 2048, notes: 3000, status: 12, collection: 80 };
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const locationKey = value => (value || '').trim().toLowerCase();
export function townSuggestions(state = '', places = [], { includeDeleted = false } = {}) {
  const defaults = state ? (TOWNS_BY_STATE[state] || []) : Object.values(TOWNS_BY_STATE).flat();
  const saved = places
    .filter(place => (includeDeleted || !place.deleted_at) && place.area && (!state || place.state === state))
    .map(place => place.area.trim())
    .filter(Boolean);
  const unique = new Map();
  for (const town of [...defaults, ...saved]) if (!unique.has(town.toLowerCase())) unique.set(town.toLowerCase(), town);
  return [...unique.values()].sort((a, b) => a.localeCompare(b, 'en-MY'));
}
export function stateForTown(value = '', places = []) {
  const town = locationKey(value);
  if (!town) return '';
  const states = new Set(Object.entries(TOWNS_BY_STATE)
    .filter(([, towns]) => towns.some(name => locationKey(name) === town))
    .map(([state]) => state));
  for (const state of places
    .filter(place => !place.deleted_at && locationKey(place.area) === town && STATES.includes(place.state))
    .map(place => place.state)) states.add(state);
  return states.size === 1 ? [...states][0] : '';
}
export function sourceName(value = '') {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'TikTok';
    if (host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch' || host === 'fb.com') return 'Facebook';
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'Instagram';
    return value ? 'Link' : 'Screenshot';
  } catch { return 'Screenshot'; }
}
export function safeUrl(value) {
  if (!value) return '';
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function mapLink(place) {
  return safeUrl(place.map_url) || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.title, place.area, place.state, 'Malaysia'].filter(Boolean).join(', '))}`;
}
export function matchPlace(place, { query = '', state = '', area = '', category = '', status = '', collection = '', view = 'saved' } = {}) {
  if (view === 'trash' ? !place.deleted_at : !!place.deleted_at) return false;
  if (view === 'favourites' && !place.favourite) return false;
  const haystack = [place.title, place.area, place.state, place.notes, place.category, place.collection, sourceName(place.source_url)].join(' ').toLowerCase();
  return (!query || haystack.includes(query.toLowerCase())) && (!state || locationKey(place.state) === locationKey(state)) && (!area || locationKey(place.area) === locationKey(area)) && (!category || place.category === category) && (!status || place.status === status) && (!collection || place.collection === collection);
}
// Project the durable cloud snapshot plus unacknowledged local jobs. Never send a whole list back.
export function projectPlaces(records, jobs) {
  const map = new Map(records.map(p => [p.id, structuredClone(p)]));
  for (const job of [...jobs].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    if (job.kind === 'create' && !map.has(job.placeId)) map.set(job.placeId, { ...DEFAULT_PLACE, ...job.data, id: job.placeId, media: [], created_at: job.createdAt, updated_at: job.createdAt, deleted_at: null });
    const place = map.get(job.placeId);
    if (!place) continue;
    if (job.kind === 'patch' && !place.deleted_at) Object.assign(place, job.data);
    if (job.kind === 'trash') place.deleted_at = job.createdAt;
    if (job.kind === 'restore') place.deleted_at = null;
    if (job.kind === 'upload' && !place.deleted_at && !place.media.some(m => m.id === job.mediaId)) place.media.push({ id: job.mediaId, content_type: job.blob.type, name: job.name, pending: true, blob: job.blob });
    if (job.kind === 'remove-media') place.media = place.media.filter(m => m.id !== job.mediaId);
    place.pending = true;
    if (job.error) place.syncError = job.error;
  }
  return [...map.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
