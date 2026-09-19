import { mapUrl, normalizeState, parseMapLink } from '../public/js/map-location.js';

export class LocationError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}
const headers = { 'User-Agent': 'PikaPlaces/1.0 (+https://github.com/naz1234/pika-places)', 'Accept-Language': 'en' };
const emptyMessage = 'Could not detect the location from this link. Choose the state and town manually.';

async function readLimited(response, maximum = 262144) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > maximum) throw new LocationError(emptyMessage);
      parts.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder().decode(bytes);
}

export function locationFromPhoton(data) {
  const p = data?.features?.[0]?.properties;
  if (p?.countrycode?.toUpperCase() !== 'MY') return null;
  const state = normalizeState(p.state || '') || (!p.state && ['Kuala Lumpur', 'Labuan', 'Putrajaya'].includes(p.city) ? p.city : '');
  if (!state) return null;
  const area = String(p.city || p.district || p.county || '').slice(0, 80);
  return { state, area, attribution: 'OpenStreetMap' };
}

export async function resolveMapLocation(value, { fetcher = fetch, photonBase = 'https://photon.komoot.io', signal = AbortSignal.timeout(15000) } = {}) {
  let parsed = parseMapLink(value);
  if (!parsed) throw new LocationError('Use a Google Maps, Waze or Apple Maps link.', 400);
  const seen = new Set();
  for (let step = 0; step < 5; step++) {
    if (parsed.location) return { ...parsed.location, attribution: '' };
    if (parsed.point) {
      const { lat, lon } = parsed.point;
      // Skip clearly foreign coordinates; the provider must also confirm Malaysia.
      if (lat < 0.8 || lat > 7.5 || lon < 99 || lon > 119.5) throw new LocationError('This location is outside Malaysia. Choose the location manually.');
      const endpoint = new URL('/reverse', photonBase);
      if (endpoint.protocol !== 'https:') throw new LocationError('Location lookup is unavailable.', 503);
      for (const [key, val] of Object.entries({ lat, lon, lang: 'en', limit: 1, radius: 1 })) endpoint.searchParams.set(key, val);
      const response = await fetcher(endpoint.href, { headers, signal, redirect: 'error' });
      if (!response.ok) throw new LocationError('Location lookup is temporarily unavailable. Try again or choose manually.', 503);
      const location = locationFromPhoton(JSON.parse(await readLimited(response)));
      if (location) return location;
      throw new LocationError(emptyMessage);
    }
    if (seen.has(parsed.url)) break;
    seen.add(parsed.url);
    const response = await fetcher(parsed.url, { headers, signal, redirect: 'manual' });
    const redirect = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && redirect) {
      await response.body?.cancel();
      const next = mapUrl(new URL(redirect, parsed.url).href);
      if (!next) throw new LocationError(emptyMessage);
      parsed = parseMapLink(next.href); continue;
    }
    // Some Apple/Google share pages provide their destination as an OG URL.
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); break; }
    const html = await readLimited(response);
    const tag = html.match(/<meta\b[^>]*\bproperty=["']og:url["'][^>]*>/i)?.[0];
    const content = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, '&');
    const next = content && mapUrl(new URL(content, parsed.url).href);
    if (!next) break;
    parsed = parseMapLink(next.href);
  }
  throw new LocationError(emptyMessage);
}
