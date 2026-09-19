import { STATES } from './model.js';

const aliases = { 'pulau pinang': 'Penang', malacca: 'Melaka', 'malacca state': 'Melaka', 'negeri sembilan': 'Negeri Sembilan' };
export function normalizeState(value = '') {
  const name = value.toLowerCase().trim().replace(/^(?:wilayah persekutuan|federal territory of|w\.?p\.?)\s+/, '').replace(/\s+(?:darul .+|indera kayangan|federal territory)$/, '');
  return STATES.find(state => state.toLowerCase() === name) || aliases[name] || '';
}

// Keep this allowlist shared by the browser and every server-side redirect.
export function mapUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const google = /^(?:www\.)?google\.(?:com|com\.my)$/.test(host) && /^\/maps(?:\/|$)/.test(url.pathname);
    const supported = google || /^(?:maps\.google\.(?:com|com\.my)|maps\.app\.goo\.gl|maps\.apple\.com|(?:www\.)?waze\.com)$/.test(host) || (host === 'goo.gl' && url.pathname.startsWith('/maps/'));
    if (!supported) return null;
    url.protocol = 'https:'; url.hash = '';
    return url;
  } catch { return null; }
}

function coordinates(value = '') {
  const match = /^\s*(?:loc:)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*\([^)]*\))?\s*$/.exec(value);
  if (!match) return null;
  const lat = Number(match[1]), lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

export function locationFromAddress(text = '') {
  const parts = text.split(',').map(part => part.trim()).filter(Boolean);
  // A state must be a complete address component, never a word in a shop name.
  for (let i = parts.length - 1; i >= 0; i--) {
    const state = normalizeState(parts[i].replace(/^\d{5}\s+/, ''));
    if (!state) continue;
    const town = i > 0 && /^\d{5}\s+/.test(parts[i - 1]) ? parts[i - 1].replace(/^\d{5}\s+/, '') : '';
    return { state, area: town.slice(0, 80) };
  }
  return null;
}

export function parseMapLink(value) {
  const url = mapUrl(value);
  if (!url) return null;
  const params = url.searchParams;
  const destination = params.get('destination') || params.get('daddr');
  const isRoute = /\/dir(?:\/|$)/.test(url.pathname) || params.has('saddr') || params.has('origin');
  const address = destination || (!isRoute && (params.get('address') || params.get('query') || params.get('q'))) || '';
  let point = coordinates(destination || '');
  // Google place coordinates are the marker, whereas /@ is only the map viewport.
  let decoded = ''; try { decoded = decodeURIComponent(url.href); } catch { /* incomplete escape */ }
  if (!isRoute) {
    const marker = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(decoded);
    point ||= marker ? coordinates(`${marker[1]},${marker[2]}`) : null;
    for (const key of ['coordinate', 'query', 'q']) point ||= coordinates(params.get(key) || '');
    // Google ll is a search viewport; Apple and Waze use it for the shared pin.
    if (/(?:apple|waze)\.com$/.test(url.hostname)) point ||= coordinates(params.get('ll') || '');
  }
  const placePath = !isRoute && /\/maps\/place\/([^/]+)/.exec(url.pathname)?.[1];
  let placeAddress = ''; try { placeAddress = placePath ? decodeURIComponent(placePath.replace(/\+/g, ' ')) : ''; } catch { /* malformed URL */ }
  return { url: url.href, point, location: locationFromAddress(address) || locationFromAddress(placeAddress) };
}
