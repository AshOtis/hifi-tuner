/* Hi-Fi Tuner — Aurora look: the Aurora MP3 design for radio.
 * mountAurora(root, api, opts) — same api as mountMinimal. The background glows take their colours from
 * Aurora Clock (--clock-c1..3 on <body>) when it is installed, and a northern-lights palette when it isn't. */

const HFA_ICONS = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>',
  prev: '<path d="M6 6h2v12H6zM20 6v12L9 12z" fill="currentColor"/>',
  next: '<path d="M16 6h2v12h-2zM4 6v12l11-6z" fill="currentColor"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  starOn: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  vol: '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  eq: '<path d="M5 20v-6M10 20V8M15 20v-9M20 20V4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  link: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  radio: '<circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  up: '<path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
};

// northern lights: what the glows show when Aurora Clock isn't installed
const HFA_DEFAULT = [[52, 211, 153], [20, 184, 166], [124, 58, 237]];

function mountAurora(root, api, opts = {}) {
  const openUrl = opts.openUrl || (u => window.open(u));
  const TAGS = ['ambient', 'chillout', 'downtempo', 'jazz', 'classical', 'lofi', 'drone'];
  const NS = 'http://www.w3.org/2000/svg';
  let S = null, tab = 'focus', results = [], searchMsg = '', listKey = '', stopped = false, query = '';

  const h = (tag, cls, text, parent) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; if (parent) parent.appendChild(n); return n; };
  const svg = (name, size = 18) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'hfa-ico');
    const doc = new DOMParser().parseFromString('<svg xmlns="' + NS + '">' + HFA_ICONS[name] + '</svg>', 'image/svg+xml');
    for (const c of [...doc.documentElement.childNodes]) s.appendChild(document.importNode(c, true));
    return s;
  };
  const setIco = (b, name, size) => { const old = b.querySelector('.hfa-ico'); const n = svg(name, size); old ? b.replaceChild(n, old) : b.prepend(n); };
  const btn = (parent, icon, title, cls, fn, size) => {
    const b = h('button', 'hfa-btn' + (cls ? ' ' + cls : ''), null, parent);
    if (icon) b.appendChild(svg(icon, size || 18));
    b.title = title; b.setAttribute('aria-label', title);
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return b;
  };
  const pill = (parent, text, title, fn, cls) => { const b = h('button', 'hfa-btn hfa-pill' + (cls ? ' ' + cls : ''), text, parent); if (title) b.title = title; b.addEventListener('click', fn); return b; };
  const cmd = async (name, args) => { const r = await api.cmd(name, args); if (r && r.presets) { S = r; paint(); } return r; };
  const isPreset = st => !!(S && st && S.presets.some(p => p.id === st.id));
  const sub = st => [st.tags, st.country].filter(Boolean).join(' · ');

  root.classList.add('hfa');
  root.textContent = '';
  const sky = h('div', 'hfa-sky', null, root);
  const glows = [0, 1, 2].map(i => h('div', 'hfa-glow hfa-glow-' + i, null, sky));
  const scroll = h('div', 'hfa-scroll', null, root);

  // header
  const head = h('div', 'hfa-head', null, scroll);
  h('div', 'hfa-title', 'Hi-Fi Tuner', head);
  const headSub = h('div', 'hfa-sub', '', head);

  // now playing
  const now = h('div', 'hfa-now', null, scroll);
  const art = h('div', 'hfa-art', null, now);
  const artImg = h('img', null, null, art); artImg.alt = ''; artImg.draggable = false; artImg.hidden = true;
  const artIco = svg('radio', 40); art.appendChild(artIco);
  artImg.addEventListener('error', () => { artImg.hidden = true; artIco.style.display = ''; });
  artImg.addEventListener('load', () => { artIco.style.display = 'none'; });
  const info = h('div', 'hfa-now-info', null, now);
  const tTitle = h('div', 'hfa-now-title', null, info);
  const tSong = h('div', 'hfa-now-song', null, info);
  const tSub = h('div', 'hfa-now-sub', null, info);
  const tMeta = h('div', 'hfa-now-meta', null, info);

  // live line: a level meter when the EQ is on, a quiet rule when it isn't
  const live = h('div', 'hfa-live', null, scroll);
  const liveTag = h('span', 'hfa-livetag', 'LIVE', live);
  const meter = h('div', 'hfa-meter', null, live);
  const BARS = 28;
  const bars = Array.from({ length: BARS }, () => h('i', null, null, meter));
  const sleepTag = h('span', 'hfa-sleeptag', '', live);

  // transport
  const tr = h('div', 'hfa-transport', null, scroll);
  const bSleep = btn(tr, 'moon', 'Sleep timer: 15 / 30 / 60 / 90 min', 'hfa-small', () => cmd('sleep'));
  btn(tr, 'prev', 'Previous preset', 'hfa-mid', () => cmd('step', { dir: -1 }));
  const bPlay = btn(tr, 'play', 'Play / stop', 'hfa-big', () => cmd('toggle'), 24);
  btn(tr, 'next', 'Next preset', 'hfa-mid', () => cmd('step', { dir: 1 }));
  const bStar = btn(tr, 'star', 'Save as preset', 'hfa-small', () => S && S.station && cmd('preset', { station: S.station }));

  // extras + volume
  const ex = h('div', 'hfa-extras', null, scroll);
  const bEq = btn(ex, 'eq', 'Show / hide the level meter', 'hfa-small', () => cmd('eq'));
  const bSite = btn(ex, 'link', "Open the station's website", 'hfa-small', () => S && S.station && S.station.homepage && openUrl(S.station.homepage));
  const volWrap = h('div', 'hfa-vol', null, ex);
  volWrap.appendChild(svg('vol', 18));
  const vol = h('input', 'hfa-range', null, volWrap);
  vol.type = 'range'; vol.min = 0; vol.max = 1; vol.step = 0.01; vol.title = 'Volume';
  let dragging = false;
  vol.addEventListener('input', () => { dragging = true; vol.style.setProperty('--hfa-pct', (vol.value * 100) + '%'); api.cmd('volume', { value: Number(vol.value) }); });
  vol.addEventListener('change', () => { dragging = false; });

  // tabs
  const tabs = h('div', 'hfa-tabs', null, scroll);
  const tabBtns = {};
  for (const [id, label] of [['presets', 'Presets'], ['focus', 'Focus'], ['search', 'Search'], ['add', 'Add']]) {
    tabBtns[id] = h('button', 'hfa-btn hfa-tab', label, tabs);
    tabBtns[id].addEventListener('click', () => { tab = id; listKey = ''; paint(); });
  }
  const tools = h('div', 'hfa-tools', null, scroll);
  const list = h('div', 'hfa-rows', null, scroll);
  const msg = h('div', 'hfa-hint', null, scroll);

  // footer
  const foot = h('div', 'hfa-foot', null, scroll);
  const fSupport = h('button', 'hfa-btn hfa-link', 'Support SomaFM', foot);
  fSupport.addEventListener('click', () => openUrl('https://somafm.com/support/'));
  for (const x of opts.footExtras || []) { const l = h('button', 'hfa-btn hfa-link', x.label, foot); l.title = x.title || ''; l.addEventListener('click', x.onClick); }

  function paint() {
    if (!S) return;
    const st = S.station;
    tTitle.textContent = st ? st.name : 'No station';
    let song = '', subLine = st ? sub(st) : 'Pick a station below';
    if (S.error) song = S.error;
    else if (S.buffering || S.status) song = S.status || 'Tuning…';
    else if (S.on) song = S.nowPlaying || 'On air';
    else if (st) song = 'Stopped';
    tSong.textContent = song;
    tSong.classList.toggle('is-err', !!S.error);
    tSub.textContent = subLine;
    tMeta.textContent = st ? [st.codec, st.bitrate ? st.bitrate + 'K' : '', st.source === 'soma' ? 'SomaFM' : st.source === 'custom' ? 'Your stream' : ''].filter(Boolean).join(' · ') : '';

    const img = st && st.image ? st.image : '';
    if (artImg.dataset.src !== img) {
      artImg.dataset.src = img;
      if (img) { artImg.hidden = false; artImg.src = img; } else { artImg.hidden = true; artImg.removeAttribute('src'); artIco.style.display = ''; }
    }

    headSub.textContent = S.on ? (S.buffering ? 'Tuning…' : 'On air') : (S.presets.length ? S.presets.length + ' presets' : '');
    root.classList.toggle('is-on', !!S.on);
    setIco(bPlay, S.on ? 'stop' : 'play', 24);
    bPlay.classList.toggle('is-busy', !!S.buffering);
    const pre = isPreset(st);
    setIco(bStar, pre ? 'starOn' : 'star', 18);
    bStar.classList.toggle('is-on', pre);
    bStar.title = pre ? 'Remove from presets' : 'Save as preset';
    bStar.disabled = !st;
    bSleep.classList.toggle('is-on', !!S.sleepLeft);
    sleepTag.textContent = S.sleepLeft ? 'Sleep ' + S.sleepLeft + 'm' : '';
    bEq.classList.toggle('is-on', !!S.eq);
    meter.hidden = !S.eq;
    live.classList.toggle('is-live', !!S.on && !S.buffering);
    bSite.disabled = !(st && st.homepage);
    if (!dragging) { vol.value = S.volume; vol.style.setProperty('--hfa-pct', (S.volume * 100) + '%'); }
    fSupport.hidden = !(st && st.source === 'soma');
    for (const id in tabBtns) tabBtns[id].classList.toggle('is-on', id === tab);
    paintList();
  }

  function paintList() {
    const items = tab === 'presets' ? S.presets : tab === 'focus' ? S.focus : tab === 'search' ? results : S.customs;
    const key = [tab, S.station && S.station.id, items.map(i => i.id).join('|'), S.presets.map(p => p.id).join('|'), searchMsg].join('§');
    if (key === listKey) return;
    listKey = key;
    if (tools.dataset.tab !== tab) buildTools();
    list.textContent = '';
    list.hidden = !items.length;
    items.forEach((st, i) => {
      const row = h('div', 'hfa-row', null, list);
      row.tabIndex = 0;
      if (S.station && st.id === S.station.id) row.classList.add('is-current');
      h('span', 'hfa-num', tab === 'presets' ? String(i + 1) : '', row).appendChild(tab === 'presets' ? document.createTextNode('') : svg('radio', 16));
      const mid = h('div', 'hfa-row-mid', null, row);
      h('div', 'hfa-row-title', st.name, mid);
      const s = sub(st); if (s) h('div', 'hfa-row-sub', s, mid);
      row.addEventListener('click', () => cmd('play', { station: st }));
      row.addEventListener('keydown', e => { if (e.key === 'Enter') cmd('play', { station: st }); });
      const acts = h('div', 'hfa-acts', null, row);
      if (tab === 'presets') {
        btn(acts, 'up', 'Move up', 'hfa-x', () => cmd('movePreset', { id: st.id, dir: -1 }), 16);
        btn(acts, 'down', 'Move down', 'hfa-x', () => cmd('movePreset', { id: st.id, dir: 1 }), 16);
        btn(acts, 'close', 'Remove preset', 'hfa-x', () => cmd('preset', { station: st }), 16);
      } else {
        const p = isPreset(st);
        btn(acts, p ? 'starOn' : 'star', p ? 'Remove from presets' : 'Save as preset', 'hfa-x' + (p ? ' is-on' : ''), () => cmd('preset', { station: st }), 16);
        if (tab === 'add') btn(acts, 'close', 'Delete', 'hfa-x', () => cmd('removeCustom', { id: st.id }), 16);
      }
    });
    let m = '';
    if (tab === 'presets' && !items.length) m = 'No presets yet. Tap the star on any station to keep it here.';
    if (tab === 'focus' && !items.length) m = 'Loading the focus stations…';
    if (tab === 'search') m = searchMsg || (items.length ? '' : 'Search 50,000 stations by name, or pick a genre.');
    if (tab === 'add' && !items.length) m = 'Paste a direct stream address to add your own station.';
    msg.textContent = m; msg.hidden = !m;
  }

  function buildTools() {
    tools.dataset.tab = tab;
    tools.textContent = '';
    if (tab === 'search') {
      const f = h('form', 'hfa-search', null, tools);
      f.appendChild(svg('search', 16));
      const q = h('input', 'hfa-input', null, f);
      q.placeholder = 'Search stations or #genre'; q.value = query;
      f.addEventListener('submit', e => { e.preventDefault(); query = q.value; run(q.value); });
      const chips = h('div', 'hfa-chips', null, tools);
      for (const t of TAGS) pill(chips, t, null, () => { q.value = query = '#' + t; run('#' + t); });
    } else if (tab === 'add') {
      const f = h('form', 'hfa-form', null, tools);
      const n = h('input', 'hfa-input', null, f); n.placeholder = 'Name';
      const u = h('input', 'hfa-input', null, f); u.placeholder = 'https://…';
      const go = h('button', 'hfa-btn hfa-pill hfa-pill-accent', 'Add and play', f); go.type = 'submit';
      f.addEventListener('submit', async e => {
        e.preventDefault();
        await cmd('addCustom', { name: n.value, url: u.value, play: true });
        if (!S.error) { n.value = ''; u.value = ''; }
        listKey = ''; paint();
      });
    }
  }

  async function run(q) {
    searchMsg = 'Searching…'; results = []; listKey = ''; paint();
    const r = await api.cmd('search', { query: q });
    results = (r && r.results) || [];
    searchMsg = r && r.error ? r.error : (results.length ? '' : 'Nothing found.');
    listKey = ''; paint();
  }

  /* ---------- the sky: three soft glows in the clock's colours ---------- */
  const paths = [
    { ax: 0.42, ay: 0.30, fx: 1.0, fy: 0.7, px: 0.0, py: 1.3, cx: 0.25, cy: 0.18, size: 0.95 },
    { ax: 0.38, ay: 0.36, fx: 0.8, fy: 1.1, px: 2.1, py: 0.4, cx: 0.75, cy: 0.42, size: 0.85 },
    { ax: 0.34, ay: 0.28, fx: 1.2, fy: 0.9, px: 4.0, py: 2.6, cx: 0.45, cy: 0.80, size: 0.80 }
  ];
  const parse = v => { const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v || ''); return m ? [+m[1], +m[2], +m[3]] : null; };
  let target = HFA_DEFAULT, cols = HFA_DEFAULT.map(c => c.slice()), phase = 0, speed = 0.04, bright = 0.3, level = 0, lastSky = 0, lastRead = 0;
  function readClock() {
    const cs = getComputedStyle(document.body);
    const c = [1, 2, 3].map(i => parse(cs.getPropertyValue('--clock-c' + i)));
    target = c.every(Boolean) ? c : HFA_DEFAULT;
  }
  function stepSky(dt) {
    const on = S && S.on && !S.buffering;
    speed += ((on ? 0.1 : 0.03) - speed) * Math.min(1, dt * 0.8);
    bright += ((on ? 0.42 + level * 0.25 : 0.26) - bright) * Math.min(1, dt * 2);
    cols = cols.map((c, i) => c.map((v, j) => v + (target[i][j] - v) * Math.min(1, dt * 0.6)));
    phase += dt * speed;
    const w = root.clientWidth || 360, hh = root.clientHeight || 600, unit = Math.max(w, hh * 0.7);
    glows.forEach((el, i) => {
      const p = paths[i];
      const x = (p.cx + p.ax * Math.sin(phase * p.fx + p.px)) * w, y = (p.cy + p.ay * Math.sin(phase * p.fy + p.py)) * hh;
      const s = unit * p.size * (0.9 + 0.15 * Math.sin(phase * 0.7 + i)), c = cols[i];
      el.style.setProperty('--hfa-x', (x - 200).toFixed(1) + 'px');
      el.style.setProperty('--hfa-y', (y - 200).toFixed(1) + 'px');
      el.style.setProperty('--hfa-k', (s / 400).toFixed(3));
      el.style.setProperty('--hfa-c', `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`);
      el.style.setProperty('--hfa-o', (bright * (i === 2 ? 0.75 : 1)).toFixed(3));
    });
    // the station tile picks up the same colours
    art.style.setProperty('--hfa-a', `rgb(${cols[0].map(v => v | 0).join(',')})`);
    art.style.setProperty('--hfa-b', `rgb(${cols[2].map(v => v | 0).join(',')})`);
  }

  // one loop: sky at ~25 fps, meter at ~30 fps while it's showing; nothing while hidden
  let raf = 0, busy = false, lvl = new Array(BARS).fill(0);
  async function frame(ts) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden || !root.isConnected) return;
    if (ts - lastRead > 5000) { lastRead = ts; readClock(); }
    if (ts - lastSky >= 40) { const dt = Math.min(0.2, (ts - (lastSky || ts)) / 1000); lastSky = ts; stepSky(dt); }
    if (busy || !S || meter.hidden) { level *= 0.95; return; }
    busy = true;
    try {
      const data = S.vizLive ? await api.cmd('viz', { cols: BARS }) : null;
      let sum = 0;
      for (let k = 0; k < BARS; k++) {
        const t = data ? Math.pow((data[k] || 0) / 255, 1.3) : 0;
        lvl[k] += (t - lvl[k]) * (t > lvl[k] ? 0.55 : 0.2);
        sum += lvl[k];
        bars[k].style.transform = `scaleY(${Math.max(0.06, lvl[k]).toFixed(3)})`;
      }
      level = sum / BARS;
    } finally { busy = false; }
  }
  readClock();
  raf = requestAnimationFrame(frame);

  (async () => { S = await api.cmd('state'); paint(); })();
  const poll = setInterval(async () => { if (stopped) return; const r = await api.cmd('state'); if (r) { S = r; paint(); } }, 1000);

  return {
    refresh: async () => { S = await api.cmd('state'); paint(); },
    destroy: () => { stopped = true; clearInterval(poll); cancelAnimationFrame(raf); }
  };
}
