import test from 'node:test';
import assert from 'node:assert/strict';
import { mapUrl, normalizeState, parseMapLink, locationFromAddress } from '../public/js/map-location.js';
import { resolveMapLocation, locationFromPhoton } from '../server/map-location.js';
import { MapAutofill } from '../public/js/map-autofill.js';
import { api, testEnv } from './helpers.mjs';

const short = 'https://maps.app.goo.gl/kCkxrXQF3L9BfEWz5';
// Address returned by this actual Google share link on 2026-09-19.
const expanded = 'https://maps.google.com?q=Keropok+Warisan+Losong,+74,+Jalan+Kuala+Hiliran,+Kampung+Losong+Haji+Su,+21000+Kuala+Terengganu,+Terengganu';
const expected = { state: 'Terengganu', area: 'Kuala Terengganu' };

test('screenshot address, Malay/English state names and federal territories', () => {
  assert.deepEqual(parseMapLink(expanded).location, expected);
  for (const [input, state] of [['Pulau Pinang', 'Penang'], ['Malacca', 'Melaka'], ['Wilayah Persekutuan Kuala Lumpur', 'Kuala Lumpur'], ['Federal Territory of Putrajaya', 'Putrajaya'], ['Labuan Federal Territory', 'Labuan'], ['Selangor Darul Ehsan', 'Selangor']]) assert.equal(normalizeState(input), state);
  assert.equal(locationFromAddress('Johor Food Restaurant'), null);
  assert.equal(locationFromAddress('Kedah Road Cafe, George Town'), null);
});

test('extracts destination pins without confusing Google viewport or route origin', () => {
  const point = { lat: 5.3296, lon: 103.137 };
  for (const link of ['https://waze.com/ul?ll=5.3296,103.137&navigate=yes', 'https://maps.apple.com/?ll=5.3296,103.137&q=Shop', 'https://www.google.com/maps/search/?api=1&query=5.3296%2C103.137', 'https://www.google.com/maps/place/Shop/@3,101,10z/data=!3d5.3296!4d103.137', 'https://maps.apple.com/?coordinate=5.3296,103.137', 'https://www.google.com/maps/dir/?api=1&origin=3,101&destination=5.3296,103.137']) assert.deepEqual(parseMapLink(link).point, point);
  assert.equal(parseMapLink('https://www.google.com/maps/place/Shop/@3,101,10z').point, null);
  assert.equal(parseMapLink('https://maps.google.com?q=Shop&ll=3,101').point, null);
  assert.equal(parseMapLink('https://maps.google.com?q=99,200').point, null);
});

test('resolves actual share-link redirect without another fetch when address suffices', async () => {
  let calls = 0;
  const result = await resolveMapLocation(short, { fetcher: async (url, options) => {
    calls++; assert.equal(url, short); assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: expanded } });
  } });
  assert.deepEqual(result, { ...expected, attribution: '' }); assert.equal(calls, 1);
});

test('restricts destinations at every redirect and bounds loops', async () => {
  for (const url of ['https://localhost/maps', 'https://127.0.0.1', 'https://www.google.com.evil.test/maps', 'https://user:pass@maps.google.com', 'https://www.google.com/url?q=https://evil.test', 'https://maps.google.com:444/', 'javascript:alert(1)']) assert.equal(mapUrl(url), null);
  let calls = 0;
  await assert.rejects(resolveMapLocation(short, { fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } }); } }));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(resolveMapLocation(short, { fetcher: async () => { calls++; return new Response(null, { status: 302, headers: { Location: short } }); } }));
  assert.equal(calls, 1);
});

test('coordinates use a Malaysian reverse result; foreign/unknown results stay unresolved', async () => {
  const result = await resolveMapLocation('https://waze.com/ul?ll=5.3296,103.137', { fetcher: async url => {
    assert.equal(new URL(url).pathname, '/reverse');
    return Response.json({ features: [{ properties: { countrycode: 'MY', state: 'Terengganu', city: 'Kuala Terengganu' } }] });
  } });
  assert.deepEqual(result, { ...expected, attribution: 'OpenStreetMap' });
  assert.equal(locationFromPhoton({ features: [{ properties: { countrycode: 'SG', state: 'Johor' } }] }), null);
  assert.equal(locationFromPhoton({ features: [{ properties: { countrycode: 'MY', state: 'Unknown' } }] }), null);
  await assert.rejects(resolveMapLocation('https://waze.com/ul?ll=51,-1', { fetcher: () => { throw new Error('must not fetch'); } }), /outside Malaysia/);
});

test('lookup endpoint uses existing write protection, validates requests and rate limits', async t => {
  const env = testEnv(); t.after(env.close);
  assert.equal((await api(env.env, '/api/map-location', { method: 'POST', body: { url: expanded }, headers: { Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await api(env.env, '/api/map-location', { method: 'POST', body: { url: 'https://localhost' } })).status, 400);
  assert.equal((await api(env.env, '/api/map-location', { method: 'POST', body: '{broken' })).status, 400);
  for (let i = 0; i < 15; i++) {
    const response = await api(env.env, '/api/map-location', { method: 'POST', body: { url: expanded } });
    assert.equal(response.status, 200); assert.equal((await response.json()).state, 'Terengganu');
  }
  assert.equal((await api(env.env, '/api/map-location', { method: 'POST', body: { url: expanded } })).status, 429);
});

function ui(fetcher) {
  const fields = { map_url: { value: '' }, state: { value: '' }, area: { value: '' } };
  const changes = []; const statuses = [];
  const fill = new MapAutofill({ fields, fetcher, onChange: () => changes.push([fields.state.value, fields.area.value]), onStatus: message => statuses.push(message), delay: 0 });
  fill.start(); return { fill, fields, changes, statuses };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('auto-fill saves location, preserves manual fields, clears only auto-filled stale values', async () => {
  const { fill, fields, changes } = ui();
  fields.map_url.value = expanded; fill.schedule(); await tick();
  assert.equal(fields.state.value, 'Terengganu'); assert.equal(fields.area.value, 'Kuala Terengganu'); assert.equal(changes.length, 1);
  fields.area.value = 'Losong'; fill.edited('area');
  fields.map_url.value = ''; fill.schedule();
  assert.equal(fields.state.value, ''); assert.equal(fields.area.value, 'Losong');
  fields.state.value = 'Johor'; fill.edited('state');
  fields.map_url.value = expanded; fill.schedule(); await tick();
  assert.equal(fields.state.value, 'Johor'); assert.equal(fields.area.value, 'Losong'); fill.stop();
});

test('old requests cannot affect a replacement link, closed editor or new record', async () => {
  let finish;
  const { fill, fields, changes } = ui(() => new Promise(resolve => { finish = resolve; }));
  fields.map_url.value = short; fill.schedule(); await tick();
  fields.map_url.value = 'https://maps.apple.com/?address=Shop,80000+Johor+Bahru,Johor'; fill.schedule(); await tick();
  finish(Response.json(expected)); await tick();
  assert.equal(fields.state.value, 'Johor'); assert.equal(changes.length, 1);
  fields.map_url.value = short; fill.schedule(); await tick();
  fill.stop(); fields.state.value = ''; fields.area.value = ''; fields.map_url.value = ''; fill.start();
  finish(Response.json(expected)); await tick();
  assert.equal(fields.state.value, ''); fill.stop();
});

test('manual edits during lookup win and network failures leave the form usable', async () => {
  let finish;
  const { fill, fields, statuses } = ui(() => new Promise(resolve => { finish = resolve; }));
  fields.map_url.value = short; fill.schedule(); await tick();
  fields.state.value = 'Selangor'; fill.edited('state');
  finish(Response.json(expected)); await tick();
  assert.equal(fields.state.value, 'Selangor'); assert.equal(fields.area.value, '');
  assert.match(statuses.at(-1), /entered location was kept/);
  fill.fetcher = async () => { throw new TypeError('Failed to fetch'); }; fill.schedule(); await tick();
  assert.match(statuses.at(-1), /internet/); assert.equal(fields.state.value, 'Selangor'); fill.stop();
});
