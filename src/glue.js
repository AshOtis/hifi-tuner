
/* =====================================================================
 * Obsidian glue
 * ===================================================================== */

const HFT_VIEW = 'hifi-tuner-view';

class HFTView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.ui = null; }
  getViewType() { return HFT_VIEW; }
  getDisplayText() { return 'Hi-Fi Tuner'; }
  getIcon() { return 'radio'; }

  async onOpen() { this.mount(); }

  mount() {
    if (this.ui) this.ui.destroy();
    this.contentEl.empty();
    this.contentEl.addClass('hft-host');
    const engine = this.plugin.engine;
    const api = { cmd: (n, a) => engine.command(n, a || {}) };
    const openUrl = u => window.open(u);
    const minimal = engine.d.look === 'minimal';
    this.contentEl.toggleClass('is-minimal', minimal);
    const root = this.contentEl.createDiv({ cls: 'is-tall' });
    this.ui = minimal
      ? mountMinimal(root, api, { openUrl, headExtras: [{ label: '[globe]', title: 'Switch to the globe look', onClick: () => this.plugin.setLook('globe') }] })
      : mountGlobe(root, api, { openUrl, footExtras: [{ label: '[minimal]', title: 'Switch to the minimal look', onClick: () => this.plugin.setLook('minimal') }] });
    if (this.ui.setTint) this.ui.setTint(this.plugin.tint || null);
  }

  async onClose() { if (this.ui) this.ui.destroy(); }
}

class HiFiTunerPlugin extends Plugin {
  async onload() {
    this.saveTimer = null;
    this.engine = new HFTEngine({
      load: () => this.loadData(),
      save: d => { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveData(d), 400); },
      http: async url => {
        const r = await requestUrl({ url, headers: { 'User-Agent': 'HiFiTuner/1.0 (Obsidian plugin)' }, throw: false });
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        return r.text;
      },
      onChange: () => { this.updateStatus(); this.announcePlay(); this.syncTheme(); }
    });
    await this.engine.init();
    this.engine.setupMediaSession();

    this.registerView(HFT_VIEW, leaf => new HFTView(leaf, this));
    this.addRibbonIcon('radio', 'Hi-Fi Tuner', () => this.activateView());

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('hft-status');
    this.statusEl.addEventListener('click', () => this.engine.toggle());
    this.registerInterval(window.setInterval(() => this.updateStatus(), 2000));
    this.updateStatus();

    const cmds = [
      ['open', 'Open tuner', () => this.activateView()],
      ['toggle', 'Power: play / stop', () => this.engine.toggle()],
      ['next-preset', 'Next preset', () => this.engine.step(1)],
      ['previous-preset', 'Previous preset', () => this.engine.step(-1)],
      ['store-preset', 'Store / remove current station as preset', () => this.engine.station && this.engine.command('preset', { station: this.engine.station })],
      ['sleep', 'Cycle sleep timer', () => { this.engine.cycleSleep(); const m = this.engine.snapshot().sleepLeft; new Notice(m ? `Hi-Fi Tuner: sleep in ${m} min` : 'Hi-Fi Tuner: sleep timer off'); }],
      ['volume-up', 'Volume up', () => this.engine.setVolume(this.engine.d.volume + 0.05)],
      ['volume-down', 'Volume down', () => this.engine.setVolume(this.engine.d.volume - 0.05)]
    ];
    for (let i = 1; i <= 6; i++) cmds.push([`preset-${i}`, `Play preset ${i}`, () => { const p = this.engine.d.presets[i - 1]; if (p) this.engine.play(p); else new Notice(`Hi-Fi Tuner: preset ${i} is empty`); }]);
    for (const [id, name, cb] of cmds) this.addCommand({ id, name, callback: cb });

    this.addSettingTab(new HFTSettingTab(this.app, this));

    // One player at a time: stop when another AshOtis player starts (unless allowed to play together)
    this.registerEvent(this.app.workspace.on('ashotis:playing', src => {
      if (src !== 'hifi-tuner' && this.engine.audio && this.engine.d.playTogether !== true) this.engine.stop();
    }));
    // Colour the Static Aurora theme from the station's sound
    this.registerInterval(window.setInterval(() => this.syncTheme(), 1000));
  }

  announcePlay() {
    const now = !!this.engine.audio;
    if (now && !this.wasOn) this.app.workspace.trigger('ashotis:playing', 'hifi-tuner');
    this.wasOn = now;
  }

  // Station colours for the Static Aurora theme: chosen from the station's genre tags,
  // nudged per station so neighbouring stations of the same genre still look different.
  stationColours(st) {
    const tags = ((st.tags || '') + ' ' + (st.name || '')).toLowerCase();
    const G = [
      [/ambient|drone|space|sleep|deep|meditat|chillout/, [[56, 90, 200], [30, 160, 170], [110, 70, 190]]],
      [/jazz|lounge|soul|blues|swing/, [[214, 140, 50], [150, 40, 60], [120, 70, 30]]],
      [/techno|house|electro|edm|trance|dance|club|synth/, [[220, 50, 170], [40, 180, 230], [110, 50, 200]]],
      [/classic|baroque|orchestr|piano|opera/, [[226, 190, 120], [180, 150, 110], [120, 90, 70]]],
      [/rock|metal|punk|grunge|indie/, [[220, 60, 40], [240, 130, 30], [90, 30, 30]]],
      [/folk|country|acoustic|bluegrass|celtic/, [[120, 160, 70], [190, 140, 70], [90, 70, 40]]],
      [/chill|mellow|lofi|lo-fi|downtempo|easy/, [[240, 160, 130], [170, 130, 210], [110, 90, 140]]],
      [/reggae|latin|world|afro|salsa|bossa/, [[60, 170, 80], [240, 200, 50], [200, 70, 40]]],
      [/news|talk|speech|sport/, [[150, 160, 180], [90, 110, 150], [60, 70, 90]]],
      [/eclectic|live|freeform|variety/, [[236, 72, 153], [249, 115, 22], [180, 83, 9]]]
    ];
    let cols = null;
    for (const [re, c] of G) if (re.test(tags)) { cols = c; break; }
    let h = 0; for (const ch of String(st.id || st.name || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
    if (!cols) {   // unknown genre: a pleasant palette from the station's name
      const hue = Math.abs(h) % 360, hsl = (hh, s, l) => { const a = s * Math.min(l, 1 - l), f = n => { const k = (n + hh / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return [f(0), f(8), f(4)]; };
      cols = [hsl(hue, 0.65, 0.55), hsl((hue + 40) % 360, 0.6, 0.5), hsl((hue + 200) % 360, 0.45, 0.35)];
    }
    const j = ((Math.abs(h) % 21) - 10) / 100;   // ±10% per station
    return cols.map(c => c.map(v => Math.max(0, Math.min(255, Math.round(v * (1 + j))))));
  }

  // The globe look takes the station's main colour too (only repaints when it changes)
  setTint(rgb) {
    const key = rgb ? rgb.join(',') : '';
    if (key === this.tintKey) return;
    this.tintKey = key; this.tint = rgb;
    for (const leaf of this.app.workspace.getLeavesOfType(HFT_VIEW)) {
      const ui = leaf.view instanceof HFTView && leaf.view.ui;
      if (ui && ui.setTint) ui.setTint(rgb);
    }
  }

  // Writes only when the station changes: every write restyles the whole Obsidian window
  syncTheme() {
    const body = document.body, e = this.engine, vars = ['--sa-c1', '--sa-c2', '--sa-c3'];
    const on = e.d.themeSync !== false && e.audio && e.station;
    if (e.d.themeSync === false) this.setTint(null);
    else if (e.audio && e.station) this.setTint(this.stationColours(e.station)[0]);
    if (!on) {
      // paused or stopped: keep the last colours on the theme; only clear when syncing is switched off
      if (e.d.themeSync === false && this.synced) { delete body.dataset.saOwner; for (const v of vars) body.style.removeProperty(v); this.synced = false; this.syncKey = ''; }
      return;
    }
    if (!this.mayColourTheme('hifi-tuner')) return;
    const key = e.station.id || e.station.url;
    if (key === this.syncKey && this.synced) return;
    const cols = this.stationColours(e.station);
    cols.forEach((c, i) => body.style.setProperty(vars[i], `rgb(${c.join(', ')})`));
    this.syncKey = key; this.synced = true;
  }

  // Only one plugin colours the theme at a time: whoever started first keeps it until they stop
  mayColourTheme(me) {
    const o = (document.body.dataset.saOwner || '').split(':');
    if (o[0] && o[0] !== me && Date.now() - Number(o[1]) < 3000) { this.synced = false; return false; }
    if (o[0] !== me) this.synced = false;   // taking over from another player: repaint
    document.body.dataset.saOwner = me + ':' + Date.now();
    return true;
  }

  setLook(look) {
    this.engine.d.look = look;
    this.engine.save();
    for (const leaf of this.app.workspace.getLeavesOfType(HFT_VIEW)) if (leaf.view instanceof HFTView) leaf.view.mount();
  }

  onunload() {
    if ((document.body.dataset.saOwner || '').startsWith('hifi-tuner:')) delete document.body.dataset.saOwner;
    for (const v of ['--sa-c1', '--sa-c2', '--sa-c3']) document.body.style.removeProperty(v);
    clearTimeout(this.saveTimer);
    this.saveData(this.engine.d);
    this.engine.destroy();
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(HFT_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: HFT_VIEW, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  updateStatus() {
    if (!this.statusEl) return;
    const s = this.engine.snapshot();
    const show = this.engine.d.statusBar !== false && s.station && (s.on || s.sleepLeft);
    this.statusEl.toggleClass('hft-hidden', !show);
    if (!show) return;
    const what = s.nowPlaying ? `${s.station.name} — ${s.nowPlaying}` : s.station.name;
    this.statusEl.setText(`${s.buffering ? '…' : '▶'} ${what}${s.sleepLeft ? `  ·  sleep ${s.sleepLeft}m` : ''}`);
    this.statusEl.setAttribute('aria-label', 'Hi-Fi Tuner: click to stop');
  }
}

class HFTSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    const e = this.plugin.engine;
    containerEl.empty();
    new Setting(containerEl).setName('Look')
      .setDesc('Globe: stations on a wireframe world map. Minimal: plain text in your vault\'s colours.')
      .addDropdown(dd => dd.addOption('globe', 'Globe').addOption('minimal', 'Minimal')
        .setValue(e.d.look === 'minimal' ? 'minimal' : 'globe').onChange(v => this.plugin.setLook(v)));
    new Setting(containerEl).setName('EQ / signal level')
      .setDesc('Level meter (minimal: ASCII EQ, globe: signal boxes and pulse). Works on stations that allow it (SomaFM does).')
      .addToggle(t => t.setValue(e.d.eq).onChange(v => { e.d.eq = v; e.save(); }));
    new Setting(containerEl).setName('Station colours')
      .setDesc('While a station plays, the globe and the Static Aurora theme take on colours that suit its genre. Turn off for the classic blue globe.')
      .addToggle(t => t.setValue(e.d.themeSync !== false).onChange(v => { e.d.themeSync = v; e.save(); this.plugin.syncTheme(); }));
    new Setting(containerEl).setName('Play alongside other players')
      .setDesc('Off: starting Static FM, Aurora MP3 or MFP Player stops the radio, and the other way round. On: let them play together.')
      .addToggle(t => t.setValue(e.d.playTogether === true).onChange(v => { e.d.playTogether = v; e.save(); }));
    new Setting(containerEl).setName('Show in status bar')
      .setDesc('Station and now-playing in the status bar. Click it to stop.')
      .addToggle(t => t.setValue(e.d.statusBar !== false).onChange(v => { e.d.statusBar = v; e.save(); this.plugin.updateStatus(); }));
    new Setting(containerEl).setName('Focus stations')
      .setDesc('Reload the hand-picked list from SomaFM.')
      .addButton(b => b.setButtonText('Reload').onClick(async () => { await e.loadFocus(); new Notice('Hi-Fi Tuner: focus list reloaded'); }));
  }
}

module.exports = HiFiTunerPlugin;
