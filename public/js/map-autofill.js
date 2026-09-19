import { parseMapLink } from './map-location.js';

export class MapAutofill {
  constructor({ fields, onChange, onStatus, fetcher = fetch, delay = 500 }) {
    Object.assign(this, { fields, onChange, onStatus, fetcher, delay });
    this.version = 0; this.active = false; this.manual = new Set(); this.automatic = {};
  }
  start() {
    this.stop(); this.active = true; this.manual = new Set(); this.automatic = {}; this.lastUrl = this.fields.map_url.value.trim();
    this.onStatus('Paste a map link to detect the state and town. You can still edit them.');
    if (this.fields.map_url.value && !this.fields.state.value) this.schedule();
  }
  stop() { this.active = false; this.version++; clearTimeout(this.timer); this.controller?.abort(); }
  edited(field) { this.manual.add(field); delete this.automatic[field]; }
  schedule() {
    clearTimeout(this.timer); this.controller?.abort(); const version = ++this.version;
    if (!this.active) return;
    const value = this.fields.map_url.value.trim();
    if (value !== this.lastUrl) {
      let changed = false;
      for (const [key, automatic] of Object.entries(this.automatic)) {
        if (!this.manual.has(key) && this.fields[key].value === automatic) { this.fields[key].value = ''; changed = true; }
      }
      this.automatic = {}; this.lastUrl = value;
      if (changed) this.onChange();
    }
    if (!value) { this.onStatus('Paste a map link to detect the state and town.'); return; }
    if (!parseMapLink(value)) { this.onStatus('Use a complete Google Maps, Waze or Apple Maps link, or choose the location manually.'); return; }
    this.onStatus('Detecting state and town…');
    this.timer = setTimeout(() => void this.lookup(value, version), this.delay);
  }
  async lookup(value, version) {
    this.controller = new AbortController();
    const controller = this.controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    const current = () => this.active && this.version === version && this.fields.map_url.value.trim() === value;
    try {
      let result = parseMapLink(value).location;
      if (!result) {
        const response = await this.fetcher('/api/map-location', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pika-Client': '1' }, body: JSON.stringify({ url: value }), signal: this.controller.signal });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Location could not be detected. Choose it manually.');
      }
      if (!current()) return;
      let changed = false;
      for (const key of ['state', 'area']) {
        if (key === 'area' && this.fields.state.value !== result.state) continue;
        if (this.manual.has(key)) continue;
        const field = this.fields[key];
        if (field.value && field.value !== this.automatic[key]) continue;
        const next = result[key] || '';
        if (field.value !== next) { field.value = next; changed = true; }
        this.automatic[key] = next;
      }
      if (changed) this.onChange();
      const detected = [result.area, result.state].filter(Boolean).join(', ');
      const kept = this.fields.state.value !== result.state || (result.area && this.fields.area.value !== result.area);
      this.onStatus(`Detected ${detected}. ${kept ? 'Your entered location was kept.' : 'You can edit this if needed.'}`, !!result.attribution);
    } catch (error) {
      if (current()) this.onStatus(error.name === 'AbortError' ? 'Location lookup timed out. Try again or choose manually.' : (error instanceof TypeError ? 'Connect to the internet to detect the location, or choose it manually.' : error.message));
    } finally { clearTimeout(timeout); }
  }
}
