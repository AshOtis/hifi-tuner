/* Hi-Fi Tuner — minimal text UI (MFP-style), uses the host's own colours and font.
 * mountMinimal(root, api, opts) — same api as mountTuner. Plain text plus an optional ASCII EQ. */

function mountMinimal(root, api, opts = {}) {
  const openUrl = opts.openUrl || (u => window.open(u));
  const TAGS = ['ambient', 'chillout', 'downtempo', 'jazz', 'classical', 'lofi', 'drone'];

  let S = null, tab = 'focus', results = [], searchMsg = '', listKey = '', stopped = false, query = '';

  const h = (tag, cls, text, parent) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };
  const b = (parent, label, title, fn, cls) => {
    const x = h('button', 'hfm-b' + (cls ? ' ' + cls : ''), label, parent);
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

  root.classList.add('hfm');
  root.textContent = '';

  const head = h('div', 'hfm-head', null, root);
  h('span', 'hfm-faint', 'radio', head);
  const extras = h('span', null, null, head);
  const bEq = b(extras, '', 'Show / hide the EQ', () => cmd('eq'));
  for (const x of opts.headExtras || []) b(extras, x.label, x.title, x.onClick);

  const viz = h('pre', 'hfm-viz', null, root);

  const now = h('div', 'hfm-now', null, root);
  const title = h('div', 'hfm-title', null, now);
  const info = h('div', 'hfm-info', null, now);

  const ctl = h('div', 'hfm-row', null, root);
  b(ctl, '[prev]', 'Previous preset', () => cmd('step', { dir: -1 }));
  const bPower = b(ctl, '[play]', 'Play / stop', () => cmd('toggle'));
  b(ctl, '[next]', 'Next preset', () => cmd('step', { dir: 1 }));
  const bMem = b(ctl, '[mem]', 'Store / remove this station as a preset', () => S && S.station && cmd('preset', { station: S.station }));

  const ctl2 = h('div', 'hfm-row', null, root);
  b(ctl2, '[v-]', 'Volume down', () => cmd('volume', { value: S.volume - 0.05 }));
  const vol = h('span', 'hfm-faint', '', ctl2);
  b(ctl2, '[v+]', 'Volume up', () => cmd('volume', { value: S.volume + 0.05 }));
  const bSleep = b(ctl2, '[sleep]', 'Sleep timer: 15 / 30 / 60 / 90 min', () => cmd('sleep'));

  const tabs = h('div', 'hfm-row hfm-tabs', null, root);
  const tabBtns = {};
  for (const id of ['presets', 'focus', 'search', 'add']) {
    tabBtns[id] = b(tabs, id, null, () => { tab = id; listKey = ''; paint(); });
  }
  const tools = h('div', 'hfm-tools', null, root);
  const list = h('ol', 'hfm-list', null, root);
  const msg = h('div', 'hfm-faint hfm-msg', null, root);

  const foot = h('div', 'hfm-foot hfm-faint', null, root);
  const fHome = b(foot, '// station site', 'Open the station\'s website', () => S.station && openUrl(S.station.homepage));
  const fSupport = b(foot, '// support somafm', 'SomaFM is listener-supported', () => openUrl('https://somafm.com/support/'));

  function paint() {
    if (!S) return;
    const st = S.station;
    title.textContent = st ? st.name : 'no station';
    let line;
    if (S.error) line = S.error;
    else if (S.buffering || S.status) line = (S.status || 'tuning…').toLowerCase();
    else if (!S.on) line = st ? 'stopped' : 'pick a station below';
    else line = S.nowPlaying || [st.tags, st.country].filter(Boolean).join(' · ') || 'on air';
    info.textContent = line;
    info.classList.toggle('is-err', !!S.error);

    bEq.textContent = S.eq ? '[eq on]' : '[eq off]';
    viz.hidden = !S.eq;
    bPower.textContent = S.buffering ? '[....]' : S.on ? '[stop]' : '[play]';
    bMem.textContent = isPreset(st) ? '[unmem]' : '[mem]';
    bMem.hidden = !st;
    vol.textContent = Math.round(S.volume * 100) + '%';
    bSleep.textContent = S.sleepLeft ? `[sleep ${S.sleepLeft}m]` : '[sleep]';
    fHome.hidden = !(st && st.homepage);
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
    items.forEach((st, i) => {
      const li = h('li', null, null, list);
      if (S.station && st.id === S.station.id) li.classList.add('is-current');
      if (isPreset(st) && tab !== 'presets') li.classList.add('is-preset');
      const name = h('span', 'hfm-name', (tab === 'presets' ? (i + 1) + ': ' : '') + st.name, li);
      name.title = [st.tags, st.country, st.bitrate ? st.bitrate + 'k' : ''].filter(Boolean).join(' · ');
      name.addEventListener('click', () => cmd('play', { station: st }));
      const acts = h('span', 'hfm-acts', null, li);
      if (tab === 'presets') {
        b(acts, '↑', 'Move up', () => cmd('movePreset', { id: st.id, dir: -1 }));
        b(acts, '↓', 'Move down', () => cmd('movePreset', { id: st.id, dir: 1 }));
        b(acts, '×', 'Remove preset', () => cmd('preset', { station: st }));
      } else {
        b(acts, isPreset(st) ? '*' : '+', isPreset(st) ? 'Remove from presets' : 'Save as preset', () => cmd('preset', { station: st }));
        if (tab === 'add') b(acts, '×', 'Delete', () => cmd('removeCustom', { id: st.id }));
      }
    });

    let m = '';
    if (tab === 'presets' && !items.length) m = '// no presets yet — press + on any station';
    if (tab === 'focus' && !items.length) m = '// loading…';
    if (tab === 'search') m = searchMsg || (items.length ? '' : '// search by name, or #tag');
    if (tab === 'add' && !items.length) m = '// paste a direct stream url';
    msg.textContent = m;
    msg.hidden = !m;
  }

  function buildTools() {
    tools.dataset.tab = tab;
    tools.textContent = '';
    if (tab === 'search') {
      const f = h('form', 'hfm-form', null, tools);
      const q = h('input', 'hfm-input', null, f);
      q.placeholder = 'name or #tag';
      q.value = query;
      f.addEventListener('submit', e => { e.preventDefault(); query = q.value; run(q.value); });
      const chips = h('div', 'hfm-row', null, tools);
      for (const t of TAGS) b(chips, '#' + t, null, () => { q.value = query = '#' + t; run('#' + t); }, 'hfm-faint');
    } else if (tab === 'add') {
      const f = h('form', 'hfm-form', null, tools);
      const n = h('input', 'hfm-input', null, f);
      n.placeholder = 'name';
      const u = h('input', 'hfm-input', null, f);
      u.placeholder = 'https://…';
      const go = h('button', 'hfm-b', '[store]', f);
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
    listKey = ''; paint();
  }

  /* ---------- ASCII EQ (MFP style) ----------
   * Columns are frequency bands, low → high. The level picks the row and glyph;
   * a faint "·" marks a slowly falling peak. Flat "_" line when silent. */
  const ROWS = 7, GLYPHS = ['.', '-', 'o', '*', "'", '^', '•', ':'];
  let cells = [], cols = 0, levels = [], peaks = [], tick = 0, last = 0, busy = false, raf = 0;

  function buildViz() {
    const probe = h('span', null, '0000000000', viz);
    const cw = probe.getBoundingClientRect().width / 10 || 7.8;
    probe.remove();
    const n = Math.max(16, Math.min(120, Math.floor(viz.clientWidth / cw)));
    if (n === cols) return;
    cols = n;
    viz.textContent = '';
    cells = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(h('span', null, ' ', viz));
      viz.appendChild(document.createTextNode('\n'));
      cells.push(row);
    }
    levels = new Array(cols).fill(0);
    peaks = new Array(cols).fill(0);
  }

  async function frame(ts) {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    if (busy || !S || viz.hidden || !viz.clientWidth || document.hidden || ts - last < 33) return;
    last = ts;
    busy = true;
    try {
      buildViz();
      const data = S.vizLive ? await api.cmd('viz', { cols }) : null;
      tick++;
      const R = ROWS - 1;
      const grid = cells.map(r => r.map(() => [' ', '']));
      for (let c = 0; c < cols; c++) {
        const t = data ? Math.pow((data[c] || 0) / 255, 1.6) : 0;
        levels[c] += (t - levels[c]) * 0.45;
        peaks[c] = Math.max(levels[c], peaks[c] - 0.012);
        const col = 'v' + Math.min(5, Math.floor(6 * c / cols));
        const row = Math.round((1 - levels[c]) * R);
        if (levels[c] < 0.03) grid[R][c] = ['_', col];
        else {
          grid[row][c] = [GLYPHS[(c * 5 + Math.floor(levels[c] * 12) + (tick >> 4)) % GLYPHS.length], col];
          const pr = Math.round((1 - peaks[c]) * R);
          if (pr < row - 1) grid[pr][c] = ['·', 'pk'];
        }
      }
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < cols; c++) {
        const el = cells[r][c], g = grid[r][c];
        if (el.textContent !== g[0]) el.textContent = g[0];
        if (el.className !== g[1]) el.className = g[1];
      }
    } finally { busy = false; }
  }
  raf = requestAnimationFrame(frame);

  (async () => { S = await api.cmd('state'); paint(); })();
  const poll = setInterval(async () => {
    if (stopped) return;
    const r = await api.cmd('state');
    if (r) { S = r; paint(); }
  }, 1000);

  return {
    refresh: async () => { S = await api.cmd('state'); paint(); },
    destroy: () => { stopped = true; clearInterval(poll); cancelAnimationFrame(raf); }
  };
}
