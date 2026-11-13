
/* =====================================================================
 * Obsidian glue
 * ===================================================================== */

const HFT_VIEW = 'hifi-tuner-view';

class HFTView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.ui = null; }
  getViewType() { return HFT_VIEW; }
  getDisplayText() { return 'Skywave'; }
  getIcon() { return 'radio'; }

  async onOpen() { this.mount(); }

  mount() {
    if (this.ui) this.ui.destroy();
    this.contentEl.empty();
    this.contentEl.addClass('hft-host');
    const engine = this.plugin.engine;
    const api = { cmd: (n, a) => engine.command(n, a || {}) };
    const openUrl = u => window.open(u);
    if (engine.d.look === 'mono') { engine.d.look = 'globe'; engine.d.palette = 'mono'; engine.save(); }   // the old "Black and white" look is the globe's black-and-white colours
    const look = ['minimal', 'aurora'].includes(engine.d.look) ? engine.d.look : 'globe';
    this.contentEl.toggleClass('is-minimal', look === 'minimal');
    this.contentEl.toggleClass('is-aurora', look === 'aurora');
    // one [look] button next to the tabs cycles Globe -> Aurora -> Minimal
    const onLook = () => this.plugin.cycleLook();
    const root = this.contentEl.createDiv({ cls: 'is-tall' });
    if (look === 'minimal') this.ui = mountMinimal(root, api, { openUrl, onLook });
    else if (look === 'aurora') this.ui = mountAurora(root, api, { openUrl, onLook, artGlobe: engine.d.artGlobe !== false, stationColours: engine.d.stationColours !== false });
    else this.ui = mountGlobe(root, api, { openUrl, onLook, palette: engine.d.palette, onPalette: id => this.plugin.setPalette(id) });
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
    this.addRibbonIcon('radio', 'Skywave', () => this.activateView());

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
      ['sleep', 'Cycle sleep timer', () => { this.engine.cycleSleep(); const m = this.engine.snapshot().sleepLeft; new Notice(m ? `Skywave: sleep in ${m} min` : 'Skywave: sleep timer off'); }],
      ['volume-up', 'Volume up', () => this.engine.setVolume(this.engine.d.volume + 0.05)],
      ['volume-down', 'Volume down', () => this.engine.setVolume(this.engine.d.volume - 0.05)]
    ];
    for (let i = 1; i <= 6; i++) cmds.push([`preset-${i}`, `Play preset ${i}`, () => { const p = this.engine.d.presets[i - 1]; if (p) this.engine.play(p); else new Notice(`Skywave: preset ${i} is empty`); }]);
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
    if (!now && this.wasOn) this.app.workspace.trigger('ashotis:stopped', 'hifi-tuner');
    this.wasOn = now;
  }

  // The theme glows in the globe's colour way. Writes only when that changes: every write restyles the whole Obsidian window
  syncTheme() {
    const body = document.body, e = this.engine, vars = ['--sa-c1', '--sa-c2', '--sa-c3'];
    // station colours: the theme takes the colours made from the station's name (Aurora look, when switched on)
    const byName = (e.d.look === 'aurora' && e.d.stationColours !== false);
    // the plain Aurora look follows Aurora Clock, so it hands the theme back to the clock instead of colouring it
    if (e.d.look === 'aurora' && !byName) { if (this.synced) this.releaseTheme(); return; }
    const on = e.d.themeSync !== false && e.audio && e.station;
    if (!on) {
      // paused or stopped: keep the last colours on the theme; only clear when syncing is switched off
      if (e.d.themeSync === false && this.synced) { delete body.dataset.saOwner; for (const v of vars) body.style.removeProperty(v); this.synced = false; this.syncKey = ''; }
      return;
    }
    if (!this.mayColourTheme('hifi-tuner')) return;
    const P = byName ? 'name:' + e.station.name : HFTGlobe.PALETTES[e.d.palette] ? e.d.palette : 'blue';
    if (P === this.syncKey && this.synced) return;
    (byName ? hftStationPalette(e.station.name).theme : HFTGlobe.PALETTES[P].theme).split('|').forEach((c, i) => body.style.setProperty(vars[i], `rgb(${c})`));
    const key = P;
    this.syncKey = key; this.synced = true;
  }

  releaseTheme() {
    const body = document.body;
    if ((body.dataset.saOwner || '').startsWith('hifi-tuner:')) delete body.dataset.saOwner;
    for (const v of ['--sa-c1', '--sa-c2', '--sa-c3']) body.style.removeProperty(v);
    this.synced = false; this.syncKey = '';
    this.app.workspace.trigger('ashotis:stopped', 'hifi-tuner');   // lets Aurora Clock take over straight away
  }

  // Only one plugin colours the theme at a time: whoever started first keeps it until they stop
  mayColourTheme(me) {
    const o = (document.body.dataset.saOwner || '').split(':');
    if (o[0] && o[0] !== me && Date.now() - Number(o[1]) < 3000) { this.synced = false; return false; }
    if (o[0] !== me) this.synced = false;   // taking over from another player: repaint
    document.body.dataset.saOwner = me + ':' + Date.now();
    return true;
  }

  cycleLook() {
    const order = ['globe', 'aurora', 'minimal'], cur = order.includes(this.engine.d.look) ? this.engine.d.look : 'globe';
    this.setLook(order[(order.indexOf(cur) + 1) % order.length]);
  }

  setPalette(v) {
    const e = this.engine;
    e.d.palette = v; e.save(); this.syncTheme();
    for (const leaf of this.app.workspace.getLeavesOfType(HFT_VIEW)) { const ui = leaf.view instanceof HFTView && leaf.view.ui; if (ui && ui.setPalette) ui.setPalette(v); }
  }

  setLook(look) {
    this.engine.d.look = look;
    this.engine.save();
    for (const leaf of this.app.workspace.getLeavesOfType(HFT_VIEW)) if (leaf.view instanceof HFTView) leaf.view.mount();
    this.syncTheme();
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
    this.statusEl.setAttribute('aria-label', 'Skywave: click to stop');
  }
}

class HFTSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    const e = this.plugin.engine;
    containerEl.empty();
    new Setting(containerEl).setName('Look and globe colours')
      .setDesc('Click the look name (for example [globe]) beside the tabs to switch between Globe, Aurora and Minimal. On the Globe look, the coloured dots at the bottom right of the globe change its colours.');
    new Setting(containerEl).setName('Colours from the station name')
      .setDesc('Aurora look: the glows, the globe and the Static Aurora theme take their colours from the name of the station that is playing. Off: they follow the time of day with Aurora Clock.')
      .addToggle(t => t.setValue(e.d.stationColours !== false).onChange(v => { e.d.stationColours = v; e.save(); this.plugin.setLook(e.d.look); }));
    new Setting(containerEl).setName('Globe in the artwork tile')
      .setDesc('Aurora look: show the globe where the station artwork would be, in the glow colours. Off: show the station\'s own artwork when it has some.')
      .addToggle(t => t.setValue(e.d.artGlobe !== false).onChange(v => { e.d.artGlobe = v; e.save(); this.plugin.setLook(e.d.look); }));
    new Setting(containerEl).setName('EQ / signal level')
      .setDesc('Level meter (minimal: ASCII EQ, globe: signal boxes and pulse). Works on stations that allow it (SomaFM does).')
      .addToggle(t => t.setValue(e.d.eq).onChange(v => { e.d.eq = v; e.save(); }));
    new Setting(containerEl).setName('Colour the Static Aurora theme')
      .setDesc(e.d.look === 'aurora' && e.d.stationColours === false
        ? 'Not used with the Aurora look: the player and the theme both follow Aurora Clock.'
        : 'While a station plays, the Static Aurora theme glows in the same colours as the globe. Has no effect with other themes.')
      .addToggle(t => t.setValue(e.d.themeSync !== false).onChange(v => { e.d.themeSync = v; e.save(); this.plugin.syncTheme(); }));
    new Setting(containerEl).setName('Play alongside other players')
      .setDesc('Off: starting Static FM, Aurora MP3 or MFP Player stops the radio, and the other way round. On: let them play together.')
      .addToggle(t => t.setValue(e.d.playTogether === true).onChange(v => { e.d.playTogether = v; e.save(); }));
    new Setting(containerEl).setName('Show in status bar')
      .setDesc('Station and now-playing in the status bar. Click it to stop.')
      .addToggle(t => t.setValue(e.d.statusBar !== false).onChange(v => { e.d.statusBar = v; e.save(); this.plugin.updateStatus(); }));
    new Setting(containerEl).setName('Focus stations')
      .setDesc('Reload the hand-picked list from SomaFM.')
      .addButton(b => b.setButtonText('Reload').onClick(async () => { await e.loadFocus(); new Notice('Skywave: focus list reloaded'); }));
  }
}

module.exports = HiFiTunerPlugin;