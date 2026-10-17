/* Hi-Fi Tuner — "war room" globe UI.
 * mountGlobe(root, api, opts) — same api as mountTuner / mountMinimal. */

function mountGlobe(root, api, opts = {}) {
  const openUrl = opts.openUrl || (u => window.open(u));
  const TAGS = ['ambient', 'chillout', 'downtempo', 'jazz', 'classical', 'lofi', 'drone'];

  let S = null, tab = 'focus', results = [], searchMsg = '', listKey = '', stopped = false, query = '';
  let prev = null, log = [], tunedAt = 0, level = 0;

  const h = (tag, cls, text, parent) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };
  const b = (parent, label, title, fn, cls) => {
    const x = h('button', 'hfg-b' + (cls ? ' ' + cls : ''), label, parent);
    if (title) x.title = title;
    x.addEventListener('click', fn);
    return x;
  };
  const cmd = async (name, args) => {
    const r = await api.cmd(name, args);
    if (r && r.presets) { S = r; paint(); }
    return r;
  };
  const isPreset = st => !!(S && st && S.presets.some(p => p.id === st.id));
  const fmtLL = loc => loc ? `${Math.abs(loc.lat).toFixed(1)}${loc.lat >= 0 ? 'N' : 'S'} ${Math.abs(loc.lon).toFixed(1)}${loc.lon >= 0 ? 'E' : 'W'}` : 'LOCATION UNKNOWN';
  const two = n => String(n).padStart(2, '0');

  root.classList.add('hfg');
  root.textContent = '';

  // Stage: globe canvas with HUD overlays
  const stage = h('div', 'hfg-stage', null, root);
  const canvas = h('canvas', 'hfg-canvas', null, stage);
  const globe = new HFTGlobe(canvas, { onPick: st => cmd('play', { station: st }), zoom: !!opts.zoom });
  if (opts.onGlobe) opts.onGlobe(globe, stage);

  const top = h('div', 'hfg-top', null, stage);
  const sig = h('div', 'hfg-sig', null, top);
  h('span', 'hfg-sig-label', 'SIGNAL', sig);
  const boxes = [5, 4, 3, 2, 1].map(n => h('span', 'hfg-box', String(n), sig));
  const clock = h('span', 'hfg-clock', '00:00:00', top);

  const hud = h('div', 'hfg-hud', null, stage);
  const hName = h('div', 'hfg-name', null, hud);
  const hNow = h('div', 'hfg-nowp', null, hud);
  const hMeta = h('div', 'hfg-meta', null, hud);

  // Controls
  const ctl = h('div', 'hfg-ctl', null, root);
  const c1 = h('span', 'hfg-grp', null, ctl);
  b(c1, '[prev]', 'Previous preset', () => cmd('step', { dir: -1 }), 'g');
  const bPower = b(c1, '[play]', 'Play / stop', () => cmd('toggle'), 'g');
  b(c1, '[next]', 'Next preset', () => cmd('step', { dir: 1 }), 'g');
  const bMem = b(c1, '[mem]', 'Store / remove this station as a preset', () => S && S.station && cmd('preset', { station: S.station }).then(() => note(isPreset(S.station) ? 'Preset stored' : 'Preset removed')), 'y');
  const c2 = h('span', 'hfg-grp', null, ctl);
  b(c2, '[v-]', 'Volume down', () => cmd('volume', { value: S.volume - 0.05 }), 'p');
  const vol = h('span', 'hfg-dim', '', c2);
  b(c2, '[v+]', 'Volume up', () => cmd('volume', { value: S.volume + 0.05 }), 'p');
  const bSleep = b(c2, '[sleep]', 'Sleep timer: 15 / 30 / 60 / 90 min', () => cmd('sleep').then(() => note(S.sleepLeft ? `Sleep timer set: ${S.sleepLeft} min` : 'Sleep timer off')), 'p');

  // Deck
  const tabs = h('div', 'hfg-tabs', null, root);
  const tabBtns = {};
  for (const id of ['presets', 'focus', 'search', 'add']) {
    tabBtns[id] = b(tabs, id.toUpperCase(), null, () => { tab = id; listKey = ''; paint(); });
  }
  const tools = h('div', 'hfg-tools', null, root);
  const list = h('ol', 'hfg-list', null, root);
  const msg = h('div', 'hfg-msg', null, root);

  const logEl = h('div', 'hfg-log', null, root);
  const foot = h('div', 'hfg-foot', null, root);
  const fHome = b(foot, '[station site]', 'Open the station\'s website', () => S.station && openUrl(S.station.homepage), 'bl');
  const fSupport = b(foot, '[support somafm]', 'SomaFM is listener-supported', () => openUrl('https://somafm.com/support/'), 'o');
  for (const x of opts.footExtras || []) b(foot, x.label, x.title, x.onClick, 'pk');

  function note(text, cls) {
    log.push({ text, cls });
    log = log.slice(-4);
    logEl.textContent = '';
    for (const l of log) h('div', l.cls || '', '• ' + l.text, logEl);
  }

  function events(n) {
    const p = prev;
    prev = n;
    if (!p) return;
    const sid = n.station && n.station.id, pid = p.station && p.station.id;
    if (sid !== pid && n.station) { note('Tuning to ' + n.station.name); tunedAt = 0; }
    if (n.playing && !p.playing) { note('Signal acquired', 'ok'); tunedAt = Date.now(); }
    if (!n.on && p.on && !n.error) note('Receiver off');
    if (n.error && n.error !== p.error) note(n.error, 'err');
    if (n.nowPlaying && n.nowPlaying !== p.nowPlaying) note('Now playing: ' + n.nowPlaying);
    if (n.sleepLeft === 0 && p.sleepLeft && n.status) note(n.status);
  }

  function paint() {
    if (!S) return;
    const st = S.station;
    const loc = hftLocate(st);
    hName.textContent = st ? st.name.toUpperCase() : 'NO STATION';
    let line;
    if (S.error) line = S.error;
    else if (S.buffering || S.status) line = S.status || 'Tuning…';
    else if (!S.on) line = st ? 'Receiver off — press [play]' : 'Pick a station below, or click a blip on the globe';
    else line = S.nowPlaying || [st.tags].filter(Boolean).join(' · ') || 'On air';
    hNow.textContent = line;
    hNow.classList.toggle('is-err', !!S.error);
    hMeta.textContent = st ? [fmtLL(loc) + (loc && !loc.exact ? ' (country)' : ''), st.country, [st.codec, st.bitrate ? st.bitrate + 'K' : ''].filter(Boolean).join(' ')].filter(Boolean).join('  ·  ').toUpperCase() : '';

    bPower.textContent = S.buffering ? '[....]' : S.on ? '[stop]' : '[play]';
    bMem.textContent = isPreset(st) ? '[unmem]' : '[mem]';
    bMem.hidden = !st;
    vol.textContent = Math.round(S.volume * 100) + '%';
    bSleep.textContent = S.sleepLeft ? `[sleep ${S.sleepLeft}m]` : '[sleep]';
    fHome.hidden = !(st && st.homepage);
    fSupport.hidden = !(st && st.source === 'soma');
    for (const id in tabBtns) tabBtns[id].classList.toggle('is-on', id === tab);

    const items = tab === 'presets' ? S.presets : tab === 'focus' ? S.focus : tab === 'search' ? results : S.customs;
    globe.setStations(items.concat(S.presets), st);
    globe.setPlaying(S.playing);
    paintList(items);
  }

  function paintList(items) {
    const key = [tab, S.station && S.station.id, items.map(i => i.id).join('|'), S.presets.map(p => p.id).join('|'), searchMsg].join('§');
    if (key === listKey) return;
    listKey = key;
    if (tools.dataset.tab !== tab) buildTools();

    list.textContent = '';
    items.forEach((st, i) => {
      const li = h('li', null, null, list);
      if (S.station && st.id === S.station.id) li.classList.add('is-current');
      if (isPreset(st)) li.classList.add('is-preset');
      const name = h('span', 'hfg-name-row', (tab === 'presets' ? (i + 1) + ' ' : '') + st.name, li);
      const meta = [st.tags, st.country, st.bitrate ? st.bitrate + 'k' : ''].filter(Boolean).join(' · ');
      name.title = meta;
      name.addEventListener('click', () => cmd('play', { station: st }));
      h('span', 'hfg-cc', (st.country || (st.source === 'soma' ? 'US' : '')).toUpperCase(), li);
      const acts = h('span', 'hfg-acts', null, li);
      if (tab === 'presets') {
        b(acts, '↑', 'Move up', () => cmd('movePreset', { id: st.id, dir: -1 }));
        b(acts, '↓', 'Move down', () => cmd('movePreset', { id: st.id, dir: 1 }));
        b(acts, '×', 'Remove preset', () => cmd('preset', { station: st }));
      } else {
        b(acts, isPreset(st) ? '★' : '☆', isPreset(st) ? 'Remove from presets' : 'Save as preset', () => cmd('preset', { station: st }), isPreset(st) ? 'y' : '');
        if (tab === 'add') b(acts, '×', 'Delete', () => cmd('removeCustom', { id: st.id }));
      }
    });

    let m = '';
    if (tab === 'presets' && !items.length) m = '// no presets — press ☆ on any station, or [mem]';
    if (tab === 'focus' && !items.length) m = '// loading…';
    if (tab === 'search') m = searchMsg || (items.length ? '' : '// search by name, or #tag — results appear on the globe');
    if (tab === 'add' && !items.length) m = '// paste a direct stream url';
    msg.textContent = m;
    msg.hidden = !m;
  }

  function buildTools() {
    tools.dataset.tab = tab;
    tools.textContent = '';
    if (tab === 'search') {
      const f = h('form', 'hfg-form', null, tools);
      const q = h('input', 'hfg-input', null, f);
      q.placeholder = 'name or #tag';
      q.value = query;
      const go = h('button', 'hfg-b g', '[seek]', f);
      go.type = 'submit';
      f.addEventListener('submit', e => { e.preventDefault(); query = q.value; run(q.value); });
      const chips = h('div', 'hfg-chips', null, tools);
      for (const t of TAGS) b(chips, '#' + t, null, () => { q.value = query = '#' + t; run('#' + t); }, 'dim');
    } else if (tab === 'add') {
      const f = h('form', 'hfg-form', null, tools);
      const n = h('input', 'hfg-input', null, f);
      n.placeholder = 'name';
      const u = h('input', 'hfg-input', null, f);
      u.placeholder = 'https://…';
      const go = h('button', 'hfg-b g', '[store]', f);
      go.type = 'submit';
      f.addEventListener('submit', async e => {
        e.preventDefault();
        await cmd('addCustom', { name: n.value, url: u.value, play: true });
        if (!S.error) { n.value = ''; u.value = ''; }
        listKey = ''; paint();
      });
    }
  }

  async function run(q) {
    searchMsg = '// searching…'; results = []; listKey = ''; paint();
    const r = await api.cmd('search', { query: q });
    results = (r && r.results) || [];
    searchMsg = r && r.error ? '// ' + r.error.toLowerCase() : (results.length ? '' : '// nothing found');
    if (results.length) note(`${results.length} stations found for ${q}`);
    listKey = ''; paint();
  }

  // Level → signal boxes + globe pulse
  let lvlBusy = false, raf = 0, lastL = 0;
  async function levelLoop(ts) {
    if (stopped) return;
    raf = requestAnimationFrame(levelLoop);
    if (lvlBusy || !S || ts - lastL < 50 || document.hidden) return;
    lastL = ts;
    lvlBusy = true;
    try {
      let target = 0;
      if (S.playing && S.vizLive && S.eq) {
        const d = await api.cmd('viz', { cols: 16 });
        if (d) target = Math.min(1, d.reduce((a, v) => a + v, 0) / d.length / 160);
      }
      level += (target - level) * (target > level ? 0.5 : 0.15);
      globe.setLevel(level);
      const lit = S.playing ? (S.vizLive && S.eq ? Math.ceil(level * 5) : 1) : 0;
      boxes.forEach((bx, i) => bx.classList.toggle('on', 4 - i < lit));
      if (tunedAt && S.playing) {
        const s = Math.floor((Date.now() - tunedAt) / 1000);
        clock.textContent = `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
      } else if (!S.on) clock.textContent = '00:00:00';
    } finally { lvlBusy = false; }
  }

  (async () => {
    S = await api.cmd('state');
    prev = S;
    if (S.playing) tunedAt = Date.now();
    note('Receiver ready');
    paint();
    globe.start();
    raf = requestAnimationFrame(levelLoop);
    const land = await api.cmd('land');
    if (land) globe.setLand(land);
  })();
  const poll = setInterval(async () => {
    if (stopped) return;
    const r = await api.cmd('state');
    if (r) { events(r); S = r; paint(); }
  }, 800);

  // Colour way: blue (classic), brown, terminal or aurora. Blue uses the stylesheet's own values.
  function setPalette(name) {
    const T = globe.setPalette(name);
    const c = k => `rgb(${T[k]})`;
    const vars = { '--g-acc': T.acc, '--g-hi': T.hi, '--g-deep': T.deep, '--g-pan': T.pan, '--g-box': T.box, '--g-on': T.on, '--g-red-rgb': T.red,
      '--g-green': c('green'), '--g-soft': c('soft'), '--g-yellow': c('yellow'), '--g-red': c('red'), '--g-purple': c('purple'), '--g-orange': c('orange'), '--g-pink': c('pink') };
    for (const k in vars) globe.palette === 'blue' ? root.style.removeProperty(k) : root.style.setProperty(k, vars[k]);
  }
  setPalette(opts.palette);

  return {
    setPalette,
    refresh: async () => { S = await api.cmd('state'); paint(); },
    destroy: () => { stopped = true; clearInterval(poll); cancelAnimationFrame(raf); globe.stop(); }
  };
}
