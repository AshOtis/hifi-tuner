/* Hi-Fi Tuner — shared radio engine (used by the Firefox add-on and the Obsidian plugin).
 * The host supplies: load(), save(data), http(url) -> text, onChange(). */

const HFT_SOMA_FOCUS = [
  'groovesalad', 'dronezone', 'deepspaceone', 'spacestation', 'missioncontrol', 'lush',
  'synphaera', 'fluid', 'sonicuniverse', 'beatblender', 'secretagent', 'vaporwaves',
  'n5md', 'defcon', 'gsclassic', 'dz2', 'darkzone', 'thetrip', 'cliqhop', 'bossa'
];

const HFT_EXTRA = [
  { id: 'rp-main', name: 'Radio Paradise', url: 'https://stream.radioparadise.com/mp3-128',
    homepage: 'https://radioparadise.com', tags: 'eclectic', codec: 'MP3', bitrate: 128, source: 'curated' },
  { id: 'rp-mellow', name: 'Radio Paradise Mellow', url: 'https://stream.radioparadise.com/mellow-128',
    homepage: 'https://radioparadise.com', tags: 'mellow, eclectic', codec: 'MP3', bitrate: 128, source: 'curated' },
  { id: 'nts-1', name: 'NTS 1', url: 'https://stream-relay-geo.ntslive.net/stream',
    homepage: 'https://www.nts.live', tags: 'eclectic, live', codec: 'MP3', bitrate: 256, source: 'curated' },
  { id: 'nts-2', name: 'NTS 2', url: 'https://stream-relay-geo.ntslive.net/stream2',
    homepage: 'https://www.nts.live', tags: 'eclectic, live', codec: 'MP3', bitrate: 256, source: 'curated' }
];

const HFT_RB_FALLBACK = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
const HFT_SLEEP_STEPS = [0, 15, 30, 60, 90];
const HFT_FACES = ['black', 'silver', 'walnut'];
const HFT_DISPLAYS = ['teal', 'amber', 'green', 'blue'];

function hftSomaStation(ch) {
  const id = typeof ch === 'string' ? ch : ch.id;
  const pls = (ch.playlists || []).find(p => p.format === 'mp3') || { url: `https://api.somafm.com/${id}.pls` };
  return {
    id: 'soma:' + id, somaId: id,
    name: ch.title || id.replace(/^./, c => c.toUpperCase()),
    pls: pls.url.replace(/^http:/, 'https:'),
    url: null,
    homepage: `https://somafm.com/${id}/`,
    support: 'https://somafm.com/support/',
    tags: (ch.genre || 'ambient').replace(/\|/g, ', '),
    description: ch.description || '',
    image: (ch.largeimage || ch.image || '').replace(/^http:/, 'https:'),
    codec: 'MP3', bitrate: 128, country: 'US', source: 'soma'
  };
}

class HFTEngine {
  constructor(host) {
    this.host = host;
    this.d = {
      presets: [], customs: [], volume: 0.7, lastStation: null,
      face: 'black', display: 'teal', eq: true,
      focus: { list: [], at: 0 }, vizOk: {}
    };
    this.station = null;
    this.audio = null;
    this.ctx = null;
    this.analyser = null;
    this.freq = null;
    this.status = '';
    this.error = '';
    this.nowPlaying = '';
    this.buffering = false;
    this.sleepAt = 0;
    this.attempts = [];
    this.attemptIdx = 0;
    this.pendingVizFail = null;
    this.rbServers = null;
    this.lastSomaPoll = 0;
    this.stallTimer = null;
  }

  async init() {
    const saved = await this.host.load();
    if (saved) Object.assign(this.d, saved);
    this.station = this.d.lastStation;
    if (!this.d.focus.list.length || Date.now() - this.d.focus.at > 24 * 3600e3) this.loadFocus();
    this.timer = setInterval(() => this.tick(), 1000);
  }

  destroy() {
    clearInterval(this.timer);
    this.stop();
    try { if (this.ctx) this.ctx.close(); } catch (_) {}
  }

  save() { return this.host.save(this.d); }
  changed() { if (this.host.onChange) this.host.onChange(); }

  /* ---------- station lists ---------- */

  async loadFocus() {
    let soma;
    try {
      const data = JSON.parse(await this.host.http('https://api.somafm.com/channels.json'));
      const byId = Object.fromEntries((data.channels || []).map(c => [c.id, c]));
      soma = HFT_SOMA_FOCUS.filter(id => byId[id]).map(id => hftSomaStation(byId[id]));
      this.applySomaNowPlaying(data.channels || []);
    } catch (_) {
      soma = HFT_SOMA_FOCUS.map(id => hftSomaStation(id));
    }
    this.d.focus = { list: soma.concat(HFT_EXTRA), at: Date.now() };
    this.save();
    this.changed();
  }

  async rbFetch(path) {
    if (!this.rbServers) {
      try {
        const list = JSON.parse(await this.host.http('https://all.api.radio-browser.info/json/servers'));
        const names = [...new Set(list.map(s => s.name).filter(Boolean))];
        for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
        this.rbServers = names.length ? names : HFT_RB_FALLBACK.slice();
      } catch (_) {
        this.rbServers = HFT_RB_FALLBACK.slice();
      }
    }
    let lastErr;
    for (const s of this.rbServers) {
      try { return JSON.parse(await this.host.http('https://' + s + path)); }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('No directory server reachable');
  }

  async search(query) {
    query = (query || '').trim();
    if (!query) return [];
    const isTag = query.startsWith('#');
    const term = encodeURIComponent(isTag ? query.slice(1) : query);
    const path = `/json/stations/search?${isTag ? 'tag' : 'name'}=${term}&limit=80&hidebroken=true&order=clickcount&reverse=true`;
    const rows = await this.rbFetch(path);
    const seen = new Set();
    return rows.map(r => ({
      id: 'rb:' + r.stationuuid, rbUuid: r.stationuuid,
      name: (r.name || 'Unnamed').trim(),
      url: (r.url_resolved || r.url || '').trim(),
      homepage: r.homepage || '', tags: (r.tags || '').split(',').slice(0, 3).join(', '),
      country: r.countrycode || '', codec: r.codec || '', bitrate: r.bitrate || 0, source: 'rb',
      lat: typeof r.geo_lat === 'number' ? r.geo_lat : null, lon: typeof r.geo_long === 'number' ? r.geo_long : null
    }))
      .filter(s => s.url && !seen.has(s.url) && seen.add(s.url))
      .sort((a, b) => (b.url.startsWith('https:') - a.url.startsWith('https:')));
  }

  addCustom(name, url) {
    url = (url || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) throw new Error('That does not look like a stream URL');
    const st = { id: 'custom:' + url, name: (name || '').trim() || url.replace(/^https?:\/\//, '').split('/')[0],
      url, homepage: '', tags: 'custom', source: 'custom' };
    this.d.customs = this.d.customs.filter(s => s.id !== st.id).concat(st);
    this.save();
    return st;
  }

  removeCustom(id) {
    this.d.customs = this.d.customs.filter(s => s.id !== id);
    this.save();
  }

  togglePreset(st) {
    const i = this.d.presets.findIndex(p => p.id === st.id);
    if (i >= 0) this.d.presets.splice(i, 1);
    else this.d.presets.push(Object.assign({}, st));
    this.save();
  }

  movePreset(id, dir) {
    const p = this.d.presets, i = p.findIndex(x => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= p.length) return;
    [p[i], p[j]] = [p[j], p[i]];
    this.save();
  }

  /* ---------- playback ---------- */

  async resolveUrl(st) {
    if (st.url) return st.url;
    if (st.pls) {
      try {
        const txt = await this.host.http(st.pls);
        const m = txt.match(/^File\d+=(.+)$/im);
        if (m) return m[1].trim().replace(/^http:/, 'https:');
      } catch (_) {}
      if (st.somaId) return `https://ice2.somafm.com/${st.somaId}-128-mp3`;
    }
    throw new Error('No stream address for this station');
  }

  makeAudio(withViz) {
    const a = new Audio();
    a.preload = 'none';
    a.volume = this.d.volume;
    if (withViz) {
      a.crossOrigin = 'anonymous';
      try {
        if (!this.ctx) {
          this.ctx = new AudioContext();
          this.analyser = this.ctx.createAnalyser();
          this.analyser.fftSize = 1024;
          this.analyser.smoothingTimeConstant = 0.7;
          this.freq = new Uint8Array(this.analyser.frequencyBinCount);
          this.analyser.connect(this.ctx.destination);
        }
        a._node = this.ctx.createMediaElementSource(a);
        a._node.connect(this.analyser);
        a._viz = true;
      } catch (_) { a._viz = false; }
    }
    a.addEventListener('playing', () => this.onPlaying(a));
    a.addEventListener('waiting', () => { if (a === this.audio) { this.buffering = true; this.changed(); } });
    a.addEventListener('error', () => this.onError(a));
    a.addEventListener('pause', () => { if (a === this.audio) this.changed(); });
    return a;
  }

  disposeAudio() {
    const a = this.audio;
    this.audio = null;
    clearTimeout(this.stallTimer);
    if (!a) return;
    try { a.pause(); a.removeAttribute('src'); a.load(); } catch (_) {}
    try { if (a._node) a._node.disconnect(); } catch (_) {}
  }

  async play(st) {
    if (!st) return;
    this.station = st;
    this.d.lastStation = st;
    this.error = '';
    this.nowPlaying = '';
    this.status = 'Tuning…';
    this.buffering = true;
    this.disposeAudio();
    this.changed();
    let url;
    try { url = await this.resolveUrl(st); }
    catch (e) { this.fail(e.message); return; }
    if (this.station !== st) return; // user tuned elsewhere meanwhile

    const urls = url.startsWith('http:') ? [url.replace(/^http:/, 'https:'), url] : [url];
    this.attempts = [];
    for (const u of urls) {
      if (this.d.eq && this.d.vizOk[u] !== false) this.attempts.push({ url: u, viz: true });
      this.attempts.push({ url: u, viz: false });
    }
    this.attemptIdx = 0;
    this.pendingVizFail = null;
    this.save();
    this.tryAttempt();
    if (st.rbUuid) this.rbFetch('/json/url/' + st.rbUuid).catch(() => {}); // directory click count
    if (st.somaId) this.pollSoma(true);
    this.updateMediaSession();
  }

  tryAttempt() {
    const c = this.attempts[this.attemptIdx];
    if (!c) {
      const plain = this.station && /^http:/.test(this.station.url || '');
      this.fail(plain
        ? 'This station only streams over plain http, which is blocked here.'
        : 'Can\'t connect to this station right now (it may be offline).');
      return;
    }
    this.disposeAudio();
    const a = this.makeAudio(c.viz);
    a._cand = c;
    this.audio = a;
    a.src = c.url;
    this.buffering = true;
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    a.play().catch(() => {});
    clearTimeout(this.stallTimer);
    this.stallTimer = setTimeout(() => { if (a === this.audio && this.buffering) this.next_attempt(c); }, 15000);
    this.changed();
  }

  next_attempt(c) {
    if (c.viz) this.pendingVizFail = c.url;
    this.attemptIdx++;
    this.tryAttempt();
  }

  onError(a) {
    if (a !== this.audio) return;
    this.next_attempt(a._cand);
  }

  async onPlaying(a) {
    if (a !== this.audio) return;
    clearTimeout(this.stallTimer);
    const c = a._cand;
    if (c.viz) {
      try { if (this.ctx.state !== 'running') await this.ctx.resume(); } catch (_) {}
      if (this.ctx.state !== 'running') { this.next_attempt(c); return; }
      this.d.vizOk[c.url] = true;
    } else if (this.pendingVizFail === c.url) {
      this.d.vizOk[c.url] = false;
    }
    this.buffering = false;
    this.status = '';
    this.error = '';
    this.save();
    this.changed();
  }

  fail(msg) {
    this.disposeAudio();
    this.buffering = false;
    this.status = '';
    this.error = msg;
    this.changed();
  }

  stop() {
    this.disposeAudio();
    this.buffering = false;
    this.status = '';
    this.changed();
  }

  isPlaying() { return !!this.audio && !this.audio.paused; }

  toggle() {
    if (this.audio) return this.stop();
    const st = this.station || this.d.presets[0] || this.d.focus.list[0];
    return this.play(st);
  }

  step(dir) {
    const list = this.d.presets.length ? this.d.presets : this.d.focus.list;
    if (!list.length) return;
    const i = this.station ? list.findIndex(s => s.id === this.station.id) : -1;
    const n = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    return this.play(list[n]);
  }

  setVolume(v) {
    this.d.volume = Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
    if (this.audio) this.audio.volume = this.d.volume;
    this.save();
  }

  cycleSleep() {
    const left = this.sleepAt ? Math.ceil((this.sleepAt - Date.now()) / 60000) : 0;
    const next = HFT_SLEEP_STEPS.find(m => m > left) || 0;
    this.sleepAt = next ? Date.now() + next * 60000 : 0;
  }

  tick() {
    if (this.sleepAt && Date.now() >= this.sleepAt) {
      this.sleepAt = 0;
      this.stop();
      this.status = 'Sleep timer — good night';
      this.changed();
    }
    if (this.isPlaying() && this.station && this.station.somaId && Date.now() - this.lastSomaPoll > 30000) this.pollSoma();
  }

  async pollSoma(force) {
    if (!force && Date.now() - this.lastSomaPoll < 30000) return;
    this.lastSomaPoll = Date.now();
    try {
      const data = JSON.parse(await this.host.http('https://api.somafm.com/channels.json'));
      this.applySomaNowPlaying(data.channels || []);
      this.changed();
    } catch (_) {}
  }

  applySomaNowPlaying(channels) {
    if (!this.station || !this.station.somaId) return;
    const ch = channels.find(c => c.id === this.station.somaId);
    if (ch && ch.lastPlaying) {
      this.nowPlaying = ch.lastPlaying;
      this.updateMediaSession();
    }
  }

  vizFrame(cols) {
    const a = this.audio;
    if (!a || a.paused || !a._viz || !this.analyser || this.buffering) return null;
    this.analyser.getByteFrequencyData(this.freq);
    const nyq = this.ctx.sampleRate / 2, n = this.freq.length, out = new Array(cols);
    const lo = Math.log(50), hi = Math.log(15000);
    for (let c = 0; c < cols; c++) {
      const b1 = Math.max(1, Math.floor(Math.exp(lo + (hi - lo) * c / cols) / nyq * n));
      const b2 = Math.max(b1 + 1, Math.ceil(Math.exp(lo + (hi - lo) * (c + 1) / cols) / nyq * n));
      let m = 0;
      for (let b = b1; b < b2 && b < n; b++) m = Math.max(m, this.freq[b]);
      out[c] = m;
    }
    return out;
  }

  /* ---------- media keys ---------- */

  setupMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const h = {
      play: () => this.toggle(), pause: () => this.stop(), stop: () => this.stop(),
      nexttrack: () => this.step(1), previoustrack: () => this.step(-1)
    };
    for (const [k, fn] of Object.entries(h)) { try { navigator.mediaSession.setActionHandler(k, fn); } catch (_) {} }
  }

  updateMediaSession() {
    if (typeof MediaMetadata === 'undefined' || !this.station) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.nowPlaying || this.station.name,
        artist: this.nowPlaying ? this.station.name : 'Hi-Fi Tuner',
        album: 'Hi-Fi Tuner'
      });
    } catch (_) {}
  }

  /* ---------- API used by the UI ---------- */

  snapshot() {
    return {
      station: this.station,
      playing: this.isPlaying() && !this.buffering,
      on: !!this.audio,
      buffering: this.buffering,
      status: this.status,
      error: this.error,
      nowPlaying: this.nowPlaying,
      volume: this.d.volume,
      presets: this.d.presets,
      customs: this.d.customs,
      focus: this.d.focus.list,
      face: this.d.face,
      display: this.d.display,
      eq: this.d.eq,
      look: this.d.look,
      vizLive: !!(this.audio && this.audio._viz && !this.buffering),
      sleepLeft: this.sleepAt ? Math.max(1, Math.ceil((this.sleepAt - Date.now()) / 60000)) : 0
    };
  }

  async command(cmd, a = {}) {
    switch (cmd) {
      case 'state': break;
      case 'play': await this.play(a.station); break;
      case 'toggle': await this.toggle(); break;
      case 'stop': this.stop(); break;
      case 'step': await this.step(a.dir); break;
      case 'volume': this.setVolume(a.value); break;
      case 'preset': this.togglePreset(a.station); break;
      case 'movePreset': this.movePreset(a.id, a.dir); break;
      case 'addCustom': {
        try { const st = this.addCustom(a.name, a.url); if (a.play) await this.play(st); }
        catch (e) { this.error = e.message; }
        break;
      }
      case 'removeCustom': this.removeCustom(a.id); break;
      case 'search': {
        try { return { results: await this.search(a.query) }; }
        catch (e) { return { results: [], error: 'Directory search failed: ' + e.message }; }
      }
      case 'sleep': this.cycleSleep(); break;
      case 'face': this.d.face = HFT_FACES[(HFT_FACES.indexOf(this.d.face) + 1) % HFT_FACES.length]; this.save(); break;
      case 'display': this.d.display = HFT_DISPLAYS[(HFT_DISPLAYS.indexOf(this.d.display) + 1) % HFT_DISPLAYS.length]; this.save(); break;
      case 'eq': this.d.eq = !this.d.eq; this.save(); break;
      case 'reloadFocus': await this.loadFocus(); break;
      case 'viz': return this.vizFrame(a.cols);
      case 'look': this.d.look = a.value; this.save(); break;
      case 'land': {
        // Detailed coastlines (Natural Earth 110m via world-atlas), fetched once per session.
        if (!this.land) {
          try {
            const topo = JSON.parse(await this.host.http('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json'));
            this.land = hftTopoArcs(topo);
          } catch (_) { this.land = null; }
        }
        return this.land;
      }
    }
    return this.snapshot();
  }
}
