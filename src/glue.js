
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
      onChange: () => this.updateStatus()
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
  }

  setLook(look) {
    this.engine.d.look = look;
    this.engine.save();
    for (const leaf of this.app.workspace.getLeavesOfType(HFT_VIEW)) if (leaf.view instanceof HFTView) leaf.view.mount();
  }

  onunload() {
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
    new Setting(containerEl).setName('Show in status bar')
      .setDesc('Station and now-playing in the status bar. Click it to stop.')
      .addToggle(t => t.setValue(e.d.statusBar !== false).onChange(v => { e.d.statusBar = v; e.save(); this.plugin.updateStatus(); }));
    new Setting(containerEl).setName('Focus stations')
      .setDesc('Reload the hand-picked list from SomaFM.')
      .addButton(b => b.setButtonText('Reload').onClick(async () => { await e.loadFocus(); new Notice('Hi-Fi Tuner: focus list reloaded'); }));
  }
}

module.exports = HiFiTunerPlugin;
