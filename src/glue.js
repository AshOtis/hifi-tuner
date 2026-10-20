
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
    const look = ['minimal', 'aurora'].includes(engine.d.look) ? engine.d.look : 'globe';
    this.contentEl.toggleClass('is-minimal', look === 'minimal');
    this.contentEl.toggleClass('is-aurora', look === 'aurora');
    const root = this.contentEl.createDiv({ cls: 'is-tall' });
    const go = to => () => this.plugin.setLook(to);
    if (look === 'minimal') this.ui = mountMinimal(root, api, { openUrl, headExtras: [
      { label: '[globe]', title: 'Switch to the globe look', onClick: go('globe') },
      { label: '[aurora]', title: 'Switch to the Aurora look', onClick: go('aurora') }] });
    else if (look === 'aurora') this.ui = mountAurora(root, api, { openUrl, footExtras: [
      { label: 'Globe look', title: 'Switch to the globe look', onClick: go('globe') },
      { label: 'Minimal look', title: 'Switch to the minimal look', onClick: go('minimal') }] });
    else this.ui = mountGlobe(root, api, { openUrl, palette: engine.d.palette, footExtras: [
      { label: '[minimal]', title: 'Switch to the minimal look', onClick: go('minimal') },
      { label: '[aurora]', title: 'Switch to the Aurora look', onClick: go('aurora') }] });
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
    if (!now && this.wasOn) this.app.workspace.trigger('ashotis:stopped', 'hifi-tuner');
    this.wasOn = now;
  }

  // The theme glows in the globe's colour way. Writes only when that changes: every write restyles the whole Obsidian window
  syncTheme() {
    const body = document.body, e = this.engine, vars = ['--sa-c1', '--sa-c2', '--sa-c3'];
    // the Aurora look follows Aurora Clock, so it hands the theme back to the clock instead of colouring it
    if (e.d.look === 'aurora') { if (this.synced) this.releaseTheme(); return; }
    const on = e.d.themeSync !== false && e.audio && e.station;
    if (!on) {
      // paused or stopped: keep the last colours on the theme; only clear when syncing is switched off
      if (e.d.themeSync === false && this.synced) { delete body.dataset.saOwner; for (const v of vars) body.style.removeProperty(v); this.synced = false; this.syncKey = ''; }
      return;
    }
    if (!this.mayColourTheme('hifi-tuner')) return;
    const P = HFTGlobe.PALETTES[e.d.palette] ? e.d.palette : 'blue';
    if (P === this.syncKey && this.synced) return;
    HFTGlobe.PALETTES[P].theme.split('|').forEach((c, i) => body.style.setProperty(vars[i], `rgb(${c})`));
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
      .setDesc('Globe: stations on a wireframe world map. Minimal: plain text in your vault\'s colours. Aurora: soft glass and glows that follow the time of day with Aurora Clock.')
      .addDropdown(dd => dd.addOption('globe', 'Globe').addOption('minimal', 'Minimal').addOption('aurora', 'Aurora').addOption('mono', 'Black and white')
        .setValue(['minimal', 'aurora'].includes(e.d.look) ? e.d.look : 'globe').onChange(v => { this.plugin.setLook(v); this.display(); }));
    new Setting(containerEl).setName('EQ / signal level')
      .setDesc('Level meter (minimal: ASCII EQ, globe: signal boxes and pulse). Works on stations that allow it (SomaFM does).')
      .addToggle(t => t.setValue(e.d.eq).onChange(v => { e.d.eq = v; e.save(); }));
    new Setting(containerEl).setName('Globe colours')
      .setDesc('Colour way for the globe look.')
      .addDropdown(dd => dd.addOption('blue', 'Blue').addOption('brown', 'Brown').addOption('terminal', 'Terminal').addOption('aurora', 'Aurora').addOption('mono', 'Black and white')
        .setValue(e.d.palette || 'blue').onChange(v => {
          e.d.palette = v; e.save(); this.plugin.syncTheme();
          for (const leaf of this.app.workspace.getLeavesOfType(HFT_VIEW)) { const ui = leaf.view instanceof HFTView && leaf.view.ui; if (ui && ui.setPalette) ui.setPalette(v); }
        }));
    new Setting(containerEl).setName('Colour the Static Aurora theme')
      .setDesc(e.d.look === 'aurora'
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
      .addButton(b => b.setButtonText('Reload').onClick(async () => { await e.loadFocus(); new Notice('Hi-Fi Tuner: focus list reloaded'); }));
  }
}

module.exports = HiFiTunerPlugin;
