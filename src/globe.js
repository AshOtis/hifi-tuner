/* Hi-Fi Tuner — wireframe "war room" globe on a canvas.
 * Orthographic projection, see-through mesh, glowing coastlines, station blips,
 * a pulsing lock on the playing station and an animated arc from home to it. */

class HFTGlobe {
  constructor(canvas, opts = {}) {
    this.c = canvas;
    this.opts = opts;
    this.g = canvas.getContext('2d');
    this.onPick = opts.onPick || (() => {});
    this.lines = HFTGlobe.densify(HFT_LOWPOLY);
    this.grid = HFTGlobe.graticule();
    this.stations = [];
    this.target = null;
    this.home = hftHome();
    this.level = 0;
    this.playing = false;
    this.lon = this.home.lon - 30;   // view centre
    this.lat = 22;
    this.goalLon = null; this.goalLat = null;
    this.userUntil = 0;
    this.hover = null;
    this.t0 = performance.now();
    this.running = false;
    this.setTint(null);
    this.bindPointer();
  }

  /* ---------- colour ----------
   * The globe's blue can be swapped for another colour (e.g. the station's palette).
   * tint: [r,g,b] or null for the classic blue. Cheap: just a few strings, no per-frame work. */
  setTint(rgb) {
    const B = rgb && rgb.length === 3 ? rgb : [90, 110, 255];
    const m = Math.max(1, ...B), b = B.map(v => v * 255 / m);              // full brightness
    const mix = (to, k) => b.map((v, i) => Math.round(v + (to[i] - v) * k)).join(',');
    const T = this.T = { acc: mix([0, 0, 0], 0), hi: mix([255, 255, 255], 0.4), lo: mix([0, 0, 0], 0.7),
      deep: b.map(v => Math.round(v * 0.045)).join(','), sph: b.map(v => Math.round(v * 0.38)).join(','), sph2: b.map(v => Math.round(v * 0.16)).join(','), bg: b.map(v => Math.round(v * 0.18)).join(',') };
    this.tintKey = rgb ? rgb.join(',') : '';
    return T;
  }

  /* ---------- data ---------- */

  setLand(arcs, force) { if (arcs && arcs.length && (force || !this.landLocked)) this.lines = HFTGlobe.densify(arcs); }

  // optional extra layers (used by the web version): { step(globe, dt, ts), under(globe, ts), over(globe, ts) }
  addLayer(layer) { (this.layers = this.layers || []).push(layer); }

  setStations(list, current) {
    const seen = new Set();
    this.stations = [];
    for (const st of list) {
      if (!st || seen.has(st.id)) continue;
      seen.add(st.id);
      const loc = hftLocate(st);
      if (loc) this.stations.push({ st, lat: loc.lat, lon: loc.lon });
    }
    const loc = hftLocate(current);
    const changed = (current && current.id) !== (this.target && this.target.st.id);
    this.target = loc ? { st: current, lat: loc.lat, lon: loc.lon, exact: loc.exact } : null;
    if (changed && this.target) { this.goalLon = this.target.lon; this.goalLat = Math.max(-35, Math.min(50, this.target.lat)); this.arcStart = performance.now(); this.userUntil = 0; }
  }

  setLevel(v) { this.level = v; }
  setPlaying(p) { this.playing = p; }

  /* ---------- geometry ---------- */

  static densify(lines) {
    return lines.map(line => {
      const out = [];
      for (let i = 0; i < line.length; i++) {
        const [lo, la] = line[i];
        if (i) {
          let [plo, pla] = line[i - 1];
          let d = lo - plo;
          if (d > 180) plo += 360; else if (d < -180) plo -= 360;
          d = lo - plo;
          const steps = Math.ceil(Math.max(Math.abs(d), Math.abs(la - pla)) / 2.5);
          for (let s = 1; s < steps; s++) out.push([plo + d * s / steps, pla + (la - pla) * s / steps]);
        }
        out.push([lo, la]);
      }
      return out;
    });
  }

  static graticule() {
    const g = [];
    for (let lat = -60; lat <= 60; lat += 20) { const l = []; for (let lon = -180; lon <= 180; lon += 4) l.push([lon, lat]); g.push(l); }
    for (let lon = -180; lon < 180; lon += 20) { const l = []; for (let lat = -84; lat <= 84; lat += 4) l.push([lon, lat]); g.push(l); }
    return g;
  }

  // Earth-frame unit vector → view coordinates (x right, y up, z towards viewer).
  view(lat, lon, r = 1) {
    const D = Math.PI / 180;
    const p = lat * D, l = (lon - this.lon) * D, p0 = this.lat * D;
    const cp = Math.cos(p), sp = Math.sin(p), c0 = Math.cos(p0), s0 = Math.sin(p0);
    return [r * cp * Math.sin(l), r * (c0 * sp - s0 * cp * Math.cos(l)), r * (s0 * sp + c0 * cp * Math.cos(l))];
  }

  vec(lat, lon) {
    const D = Math.PI / 180, p = lat * D, l = lon * D;
    return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  }

  viewVec(v) { // earth-frame 3D vector (any length) → view coords
    const D = Math.PI / 180, l0 = this.lon * D, p0 = this.lat * D;
    const X = v[0] * Math.cos(l0) + v[1] * Math.sin(l0), Y = -v[0] * Math.sin(l0) + v[1] * Math.cos(l0), Z = v[2];
    return [Y, Z * Math.cos(p0) - X * Math.sin(p0), Z * Math.sin(p0) + X * Math.cos(p0)];
  }

  /* ---------- interaction ---------- */

  bindPointer() {
    let down = null, moved = 0;
    this.c.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; moved = 0; this.c.setPointerCapture(e.pointerId); });
    this.c.addEventListener('pointermove', e => {
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        moved += Math.abs(dx) + Math.abs(dy);
        this.lon -= dx * 0.35 * (90 / Math.max(60, this.R || 120));
        this.lat = Math.max(-80, Math.min(80, this.lat + dy * 0.35 * (90 / Math.max(60, this.R || 120))));
        down = { x: e.clientX, y: e.clientY };
        this.userUntil = performance.now() + 6000;
        this.goalLon = this.goalLat = null;
      } else {
        this.hover = this.pick(e);
        this.c.classList.toggle('is-hover', !!this.hover);
      }
    });
    this.c.addEventListener('pointerup', e => {
      if (down && moved < 5) { const s = this.pick(e); if (s) this.onPick(s.st); }
      down = null;
    });
    this.c.addEventListener('pointerleave', () => { this.hover = null; });
    if (this.opts && this.opts.zoom) this.bindZoom();
  }

  // optional: mouse-wheel and pinch zoom (used by the full-screen web version)
  bindZoom() {
    this.zoom = this.zoom || 1;
    const clamp = z => Math.max(0.8, Math.min(2.8, z));
    this.c.addEventListener('wheel', e => { e.preventDefault(); this.zoom = clamp(this.zoom * Math.exp(-e.deltaY * 0.001)); }, { passive: false });
    const pts = new Map(); let base = 0, baseZoom = 1;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    this.c.addEventListener('pointerdown', e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { base = dist(); baseZoom = this.zoom; } });
    this.c.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && base) this.zoom = clamp(baseZoom * dist() / base); });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) base = 0; };
    this.c.addEventListener('pointerup', up); this.c.addEventListener('pointercancel', up);
  }

  pick(e) {
    const r = this.c.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = null, bd = 12 * 12;
    for (const s of this.stations) {
      const [x, y, z] = this.view(s.lat, s.lon);
      if (z <= 0) continue;
      const sx = this.cx + x * this.R, sy = this.cy - y * this.R;
      const d = (sx - mx) ** 2 + (sy - my) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /* ---------- loop ---------- */

  start() {
    if (this.running) return;
    this.running = true;
    let last = 0;
    const loop = ts => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (document.hidden || ts - last < 33) return;
      const dt = Math.min(100, ts - (last || ts));
      last = ts;
      this.step(dt, ts);
      this.draw(ts);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  step(dt, ts) {
    for (const L of this.layers || []) if (L.step && L.step(this, dt, ts)) return;
    if (ts < this.userUntil) return;
    if (this.goalLon != null) {
      let d = ((this.goalLon - this.lon + 540) % 360) - 180;
      this.lon += d * 0.05;
      this.lat += (this.goalLat - this.lat) * 0.05;
      if (Math.abs(d) < 0.05 && Math.abs(this.goalLat - this.lat) < 0.05) this.goalLon = this.goalLat = null;
    } else if (!this.target) {
      this.lon += dt * 0.004;                            // idle drift
    } else {
      this.lon += Math.sin(ts / 9000) * 0.01;            // gentle sway while locked
    }
  }

  /* ---------- drawing ---------- */

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.lite ? 1 : 1.5);
    const w = this.c.clientWidth, h = this.c.clientHeight;
    if (!w || !h) return false;
    if (this.c.width !== Math.round(w * dpr) || this.c.height !== Math.round(h * dpr)) {
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.R = Math.min(w * 0.46, h * 0.44) * (this.zoom || 1);
    this.cx = w / 2; this.cy = h * 0.5;
    return true;
  }

  path(line, front) {
    const g = this.g, V = line._v || HFTGlobe.vectors(line), n = V.length / 3;
    const D = Math.PI / 180, l0 = this.lon * D, p0 = this.lat * D;
    const cl = Math.cos(l0), sl = Math.sin(l0), cp = Math.cos(p0), sp = Math.sin(p0);
    const { cx, cy, R } = this;
    let pen = false;
    for (let i = 0; i < n; i++) {
      const vx = V[i * 3], vy = V[i * 3 + 1], vz = V[i * 3 + 2];
      const X = vx * cl + vy * sl, Y = -vx * sl + vy * cl;
      const z = vz * sp + X * cp;
      if ((z > 0) === front) {
        const sx = cx + Y * R, sy = cy - (vz * cp - X * sp) * R;
        if (pen) g.lineTo(sx, sy); else { g.moveTo(sx, sy); pen = true; }
      } else pen = false;
    }
  }

  // earth-frame unit vectors for a [lon, lat] polyline, cached on the line
  static vectors(line) {
    const D = Math.PI / 180, V = new Float32Array(line.length * 3);
    for (let i = 0; i < line.length; i++) {
      const p = line[i][1] * D, l = line[i][0] * D, c = Math.cos(p);
      V[i * 3] = c * Math.cos(l); V[i * 3 + 1] = c * Math.sin(l); V[i * 3 + 2] = Math.sin(p);
    }
    line._v = V;
    return V;
  }

  stroke(lines, front, style, width) {
    const g = this.g;
    g.beginPath();
    for (const l of lines) this.path(l, front);
    g.strokeStyle = style; g.lineWidth = width; g.stroke();
  }

  draw(ts) {
    const t0 = performance.now();
    this.drawFrame(ts);
    // slow machine? keep an average of frame cost and drop the costly extras if it runs high
    const ms = performance.now() - t0;
    this.cost = this.cost == null ? ms : this.cost * 0.95 + ms * 0.05;
    if (!this.lite && this.cost > 9) this.lite = true;
  }

  drawFrame(ts) {
    if (!this.resize()) return;
    const g = this.g, { w, h, cx, cy, R } = this;
    const lvl = this.playing ? this.level : 0;

    // backdrop
    const bg = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, Math.max(w, h) * 0.75);
    bg.addColorStop(0, `rgb(${this.T.bg})`); bg.addColorStop(1, `rgb(${this.T.deep})`);
    g.fillStyle = bg; g.fillRect(0, 0, w, h);

    // atmosphere + sphere
    const halo = g.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.18);
    halo.addColorStop(0, `rgba(${this.T.acc},${0.28 + lvl * 0.25})`); halo.addColorStop(1, `rgba(${this.T.acc},0)`);
    g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, R * 1.18, 0, Math.PI * 2); g.fill();
    const sph = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    sph.addColorStop(0, `rgb(${this.T.sph})`); sph.addColorStop(1, `rgb(${this.T.sph2})`);
    g.fillStyle = sph; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

    // back hemisphere (see-through mesh)
    this.stroke(this.grid, false, `rgba(${this.T.acc},0.06)`, 1);
    if (!this.lite) this.stroke(this.lines, false, `rgba(${this.T.acc},0.14)`, 1);

    // front grid + coast glow
    this.stroke(this.grid, true, `rgba(${this.T.acc},0.20)`, 1);
    if (!this.lite) this.stroke(this.lines, true, `rgba(${this.T.acc},${0.22 + lvl * 0.2})`, 4);
    this.stroke(this.lines, true, `rgba(${this.T.hi},0.95)`, 1.1);
    for (const L of this.layers || []) if (L.under) L.under(this, ts);

    // rim
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
    g.strokeStyle = `rgba(${this.T.hi},0.55)`; g.lineWidth = 1.2; g.stroke();

    // home marker
    const [hx, hy, hz] = this.view(this.home.lat, this.home.lon);
    const HX = cx + hx * R, HY = cy - hy * R;
    if (hz > 0) {
      g.beginPath(); g.moveTo(HX, HY - 6); g.lineTo(HX + 5, HY + 4); g.lineTo(HX - 5, HY + 4); g.closePath();
      g.strokeStyle = '#3cff8f'; g.lineWidth = 1.4; g.stroke();
      this.label('YOU', HX + 8, HY + 3, 'rgba(60,255,143,0.8)', 9);
    }

    // station blips
    for (const s of this.stations) {
      const [x, y, z] = this.view(s.lat, s.lon);
      if (z <= 0.02) continue;
      const sx = cx + x * R, sy = cy - y * R;
      const isT = this.target && s.st.id === this.target.st.id;
      if (isT) continue;
      g.fillStyle = this.hover === s ? '#ffffff' : 'rgba(60,255,143,0.85)';
      g.fillRect(sx - 1.5, sy - 1.5, 3, 3);
      g.fillStyle = 'rgba(60,255,143,0.18)';
      g.fillRect(sx - 3.5, sy - 3.5, 7, 7);
    }
    if (this.hover && (!this.target || this.hover.st.id !== this.target.st.id)) {
      const [x, y, z] = this.view(this.hover.lat, this.hover.lon);
      if (z > 0) this.label(this.hover.st.name.toUpperCase(), cx + x * R + 7, cy - y * R - 6, '#ffffff', 10);
    }

    // arc + target lock
    if (this.target) {
      const T = this.target;
      const [tx, ty, tz] = this.view(T.lat, T.lon);
      const TX = cx + tx * R, TY = cy - ty * R;
      this.drawArc(ts, T);
      if (tz > 0) {
        const pulse = (ts % 1600) / 1600;
        const col = this.playing ? '255,59,107' : '255,210,80';
        for (let k = 0; k < 2; k++) {
          const p = (pulse + k * 0.5) % 1;
          g.beginPath(); g.arc(TX, TY, 4 + p * (18 + lvl * 26), 0, Math.PI * 2);
          g.strokeStyle = `rgba(${col},${(1 - p) * 0.9})`; g.lineWidth = 1.4; g.stroke();
        }
        g.beginPath(); g.arc(TX, TY, 3 + lvl * 3, 0, Math.PI * 2);
        g.fillStyle = `rgb(${col})`; g.fill();
        // crosshair ticks
        g.strokeStyle = `rgba(${col},0.8)`; g.lineWidth = 1;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          g.beginPath(); g.moveTo(TX + a * 9, TY + b * 9); g.lineTo(TX + a * 15, TY + b * 15); g.stroke();
        }
        const tag = this.playing ? 'SIGNAL LOCKED' : 'STANDBY';
        const lx = TX + 18 > w - 120 ? TX - 18 - this.textW(tag, 11) : TX + 18;
        this.label(tag, lx, TY - 8, this.playing ? '#ffe14d' : 'rgba(255,225,77,0.6)', 11, true);
        if (!T.exact) this.label('~ COUNTRY', lx, TY + 6, 'rgba(255,225,77,0.5)', 8);
      }
    }
    for (const Lr of this.layers || []) if (Lr.over) Lr.over(this, ts);
  }

  drawArc(ts, T) {
    const g = this.g, { cx, cy, R } = this;
    const a = this.vec(this.home.lat, this.home.lon), b = this.vec(T.lat, T.lon);
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const ang = Math.acos(dot);
    if (ang < 0.02) return;
    const sinA = Math.sin(ang), lift = 0.08 + 0.22 * (ang / Math.PI);
    const grow = Math.min(1, (ts - (this.arcStart || 0)) / 1400);   // arc draws itself in
    const N = 64, pts = [];
    for (let i = 0; i <= N * grow; i++) {
      const t = i / N;
      const k1 = Math.sin((1 - t) * ang) / sinA, k2 = Math.sin(t * ang) / sinA;
      const r = 1 + lift * Math.sin(Math.PI * t);
      const v = [(k1 * a[0] + k2 * b[0]) * r, (k1 * a[1] + k2 * b[1]) * r, (k1 * a[2] + k2 * b[2]) * r];
      const [x, y, z] = this.viewVec(v);
      const vis = z > 0 || x * x + y * y > 1;
      pts.push([cx + x * R, cy - y * R, vis]);
    }
    g.save();
    g.setLineDash([5, 4]);
    g.lineDashOffset = -ts / 40;
    for (const [style, width] of [['rgba(60,255,143,0.25)', 3.5], ['rgba(120,255,180,0.95)', 1.2]]) {
      g.beginPath();
      let pen = false;
      for (const [x, y, vis] of pts) {
        if (vis) { if (pen) g.lineTo(x, y); else { g.moveTo(x, y); pen = true; } } else pen = false;
      }
      g.strokeStyle = style; g.lineWidth = width; g.stroke();
    }
    g.restore();
    // packet travelling along the arc
    if (this.playing && grow >= 1) {
      const i = Math.floor(((ts / 2200) % 1) * N);
      const p = pts[i];
      if (p && p[2]) { g.beginPath(); g.arc(p[0], p[1], 2.2, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill(); }
    }
  }

  textW(t, size) { this.g.font = `${size}px "HFT Mono", ui-monospace, monospace`; return this.g.measureText(t).width; }

  label(text, x, y, color, size, bold) {
    const g = this.g;
    g.font = `${bold ? '600 ' : ''}${size}px "HFT Mono", ui-monospace, monospace`;
    g.fillStyle = 'rgba(0,0,20,0.55)';
    const w = g.measureText(text).width;
    g.fillRect(x - 2, y - size + 1, w + 4, size + 3);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }
}
