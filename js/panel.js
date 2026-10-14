/* PortableGrid panel: settings form, presets, live preview and the commands sent to the host app. */
(() => {
  const Core = window.PortableGridCore;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const TARGETS = {
    illustrator: [
      ['artboard', 'Active artboard'],
      ['artboards', 'All artboards'],
      ['selection', 'Selection bounds'],
      ['each', 'Each selected object'],
    ],
    photoshop: [
      ['canvas', 'Canvas'],
      ['selection', 'Selection'],
    ],
  };
  const DEFAULTS = {
    margin: { top: '', right: '', bottom: '', left: '' },
    mirror: false,
    columns: { count: '', gutter: '', size: '', pattern: '', align: 'center' },
    rows: { count: '', gutter: '', size: '', pattern: '', align: 'center', lock: false },
    baseline: { size: '', offset: '' },
    pattern: { type: 'none', size: '' },
    overlays: { thirds: false, phi: false, spiral: false, diagonals: false, armature: false, triangles: false, flipX: false, flipY: false },
    custom: { vertical: '', horizontal: '' },
    edges: true,
    center: false,
    output: { guides: true, cells: false, artboards: false, zones: true },
    style: { color: '#00a3ff', weight: '', lineOpacity: '', cellOpacity: '', asGuides: false },
  };
  const OVERLAYS = ['thirds', 'phi', 'spiral', 'diagonals', 'armature', 'triangles'];
  const LAST_KEY = 'portablegrid.last';

  let hostInfo = { app: null, ppi: 72, unit: 'px' };
  let targets = [];
  let targetError = '';
  let busy = false;
  let builtIn = [];
  // Parts of a preset that have no form fields: platform safe zones and the artboard size.
  let extras = { zones: [], size: null };
  let mine = [];
  let layoutImages = [];
  let brands = [];
  let lastActiveKey = null;
  let preview = null; // { view, result } of the last preview, for dragging
  // Background checks (preview, artboard sync) only run while you use the panel, never while you work
  // on the canvas: requests that reach Illustrator mid-drag can get stuck.
  let pointerInPanel = false;
  const panelActive = () => !document.hidden && (pointerInPanel || document.hasFocus());

  // ---------- small helpers ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach((k) => { o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}; });
    o[keys[keys.length - 1]] = value;
  }
  function merge(base, extra) {
    const out = clone(base);
    Object.keys(extra || {}).forEach((k) => {
      const v = extra[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k], v) : v;
    });
    return out;
  }
  const storage = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not critical */ } },
  };

  function status(text, kind) {
    const el = $('#status');
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function notice(text) {
    const el = $('#notice');
    el.hidden = !text;
    el.textContent = text || '';
  }

  // ---------- form <-> spec ----------
  function readSpec() {
    const spec = clone(DEFAULTS);
    $$('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (el.type === 'checkbox') setPath(spec, k, el.checked);
      else if (el.type === 'number') setPath(spec, k, el.value === '' ? '' : Math.max(0, Math.min(500, parseInt(el.value, 10) || 0)));
      else setPath(spec, k, el.value.trim());
    });
    // Baselines, drawing grids and composition lines are drawn whenever they're set up.
    const base = Core.parseLength(spec.baseline.size);
    spec.output.baseline = !!base && base.value > 0;
    spec.output.pattern = spec.pattern.type !== 'none' && !!Core.parseLength(spec.pattern.size);
    spec.output.overlays = OVERLAYS.some((k) => spec.overlays[k]);
    spec.zones = extras.zones;
    spec.size = extras.size;
    spec.output.zones = !!spec.output.zones && spec.zones.length > 0;
    return spec;
  }

  function writeSpec(spec) {
    const full = merge(DEFAULTS, spec);
    extras = { zones: Array.isArray(spec.zones) ? spec.zones : [], size: spec.size || null };
    const sizeCard = $('#sizeCard');
    sizeCard.classList.toggle('hidden', !extras.size);
    if (extras.size) {
      $('#sizeInfo').textContent = `${spec.name || 'This preset'} is designed for ${extras.size.w} × ${extras.size.h} px.`;
      $('#addArtboard').textContent = hostInfo.app === 'photoshop' ? 'New document' : 'Add artboard';
    }
    $$('[data-k]').forEach((el) => {
      const v = getPath(full, el.dataset.k);
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.type === 'color') el.value = /^#[0-9a-f]{6}$/i.test(v || '') ? v : DEFAULTS.style.color;
      else if (el.tagName === 'SELECT') el.value = v || el.options[0].value;
      else el.value = v === undefined || v === null || v === 0 ? '' : String(v);
    });
    const m = full.margin;
    $('#linkMargins').checked = m.top !== '' && m.top === m.right && m.top === m.bottom && m.top === m.left;
    validate();
  }

  function validate() {
    let ok = true;
    $$('input[data-k]:not([type=checkbox]):not([type=number]):not([type=color])').forEach((el) => {
      const k = el.dataset.k;
      const v = el.value.trim();
      let bad = false;
      if (k.startsWith('custom.')) bad = v !== '' && v.split(/[;,\s]+/).filter(Boolean).some((s) => !Core.parseLength(s));
      else if (k.endsWith('.pattern')) bad = v !== '' && !Core.parsePattern(v);
      else bad = v !== '' && !Core.parseLength(v);
      el.classList.toggle('invalid', bad);
      if (bad) ok = false;
    });
    return ok;
  }

  // ---------- presets ----------
  function presetsFile() {
    const path = Host.node('path');
    const os = Host.node('os');
    const base = process.platform === 'win32'
      ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
      : path.join(os.homedir(), 'Library', 'Application Support');
    return path.join(base, 'PortableGrid', 'presets.json');
  }

  function loadPresets() {
    const fs = Host.node('fs');
    builtIn = JSON.parse(fs.readFileSync(`${Host.info.root}/config/presets.json`, 'utf8'));
    try {
      mine = JSON.parse(fs.readFileSync(presetsFile(), 'utf8'));
      if (!Array.isArray(mine)) mine = [];
    } catch {
      mine = [];
    }
    renderPresets();
  }

  function saveMine() {
    const fs = Host.node('fs');
    const path = Host.node('path');
    const file = presetsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(mine, null, 2));
  }

  function renderPresets(selected) {
    const sel = $('#preset');
    const opt = (value, text) => `<option value="${value}">${text.replace(/</g, '&lt;')}</option>`;
    sel.innerHTML = opt('', 'Custom grid…')
      + (mine.length ? `<optgroup label="My presets">${mine.map((p, i) => opt('m' + i, p.name)).join('')}</optgroup>` : '')
      + [...new Set(builtIn.map((p) => p.group || 'Built in'))].map((group) => `<optgroup label="${group}">${
        builtIn.map((p, i) => ((p.group || 'Built in') === group ? opt('b' + i, p.name) : '')).join('')}</optgroup>`).join('');
    sel.value = selected || '';
    $('#deletePreset').disabled = !sel.value.startsWith('m');
  }

  function presetFor(value) {
    if (!value) return null;
    return value[0] === 'm' ? mine[+value.slice(1)] : builtIn[+value.slice(1)];
  }

  // ---------- targets & preview ----------
  function context() {
    return { unit: $('#unit').value, ppi: hostInfo.ppi || 72, pxPerDoc: 1 };
  }

  // Facing pages: every second artboard mirrors its left and right margins.
  function layouts() {
    const spec = readSpec();
    const pages = $('#target').value === 'artboards' || $('#target').value === 'artboard';
    return targets.map((t) => {
      const index = t.key.startsWith('ab') ? +t.key.slice(2) : 0;
      const ctx = Object.assign(context(), { mirror: !!spec.mirror && pages && index % 2 === 1 });
      return Object.assign({ key: t.key, label: t.label, ctx }, Core.layout(t.box, spec, ctx));
    });
  }

  function style(spec) {
    const st = spec.style;
    const pct = (v, d) => (v === '' || v === undefined ? d : Math.max(5, Math.min(100, +v)));
    return {
      color: st.color,
      weight: Core.toDoc(st.weight || (hostInfo.app === 'photoshop' ? '1px' : '0.5pt'), context()),
      lineOpacity: pct(st.lineOpacity, 70),
      cellOpacity: pct(st.cellOpacity, 20),
      asGuides: hostInfo.app === 'illustrator' && !!st.asGuides,
    };
  }

  function updateIndicators(spec) {
    $$('[data-on]').forEach((el) => el.classList.toggle('active', !!spec.output[el.dataset.on]));
  }

  async function refreshTargets() {
    if (busy || !panelActive() || Host.isStalled()) return;
    try {
      const next = await Host.call('targets', { target: $('#target').value });
      const changed = JSON.stringify(next) !== JSON.stringify(targets) || targetError;
      targets = next;
      targetError = '';
      if (changed) drawPreview();
    } catch (e) {
      if (targetError !== e.message) {
        targets = [];
        targetError = e.message;
        drawPreview();
      }
    }
  }

  function drawPreview() {
    const canvas = $('#preview');
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const info = $('#previewInfo');

    if (!targets.length) {
      info.textContent = '';
      g.fillStyle = '#9a9a9a';
      g.font = '12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(targetError || 'Open a document to see the grid.', cw / 2, ch / 2);
      return;
    }
    const valid = validate();
    let result;
    try {
      result = layouts()[0];
    } catch (e) {
      info.textContent = e.message;
      return;
    }
    const spec = readSpec();
    updateIndicators(spec);
    const box = result.box;
    const pad = 14;
    const scale = Math.min((cw - pad * 2) / box.w, (ch - pad * 2) / box.h);
    const view = { scale, ox: (cw - box.w * scale) / 2 - box.x * scale, oy: (ch - box.h * scale) / 2 - box.y * scale };
    preview = { view, result };
    GridRender.draw(g, result, view, { color: spec.style.color, weight: 1, cellAlpha: 0.22, lineAlpha: 0.75 }, {
      background: '#f4f4f4', preview: true, cells: true, guides: true,
      baseline: spec.output.baseline, pattern: spec.output.pattern, overlays: spec.output.overlays, zones: spec.output.zones,
    });

    const unit = $('#unit').value;
    const toUnit = (v) => {
      const per = { px: 1, pt: 72 / (hostInfo.ppi || 72), mm: 25.4 / (hostInfo.ppi || 72), cm: 2.54 / (hostInfo.ppi || 72), in: 1 / (hostInfo.ppi || 72) }[unit];
      return +(v * per).toFixed(unit === 'px' || unit === 'pt' ? 1 : 2);
    };
    const first = result.columns[0] || result.rows[0];
    const size = result.columns.length ? ` · column ${toUnit(result.columns[0].w)} ${unit}` : (first ? ` · row ${toUnit(first.h)} ${unit}` : '');
    const more = targets.length > 1 ? ` · ${targets.length} areas` : '';
    info.textContent = (valid ? Core.describe(result) : 'Check the highlighted fields') + size + more;
  }

  // ---------- commands ----------
  async function run(label, fn) {
    if (busy) return;
    busy = true;
    $$('button').forEach((b) => { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; });
    status(label + '…');
    try {
      const msg = await fn();
      status(msg || 'Done.', 'ok');
    } catch (e) {
      status(e.message, 'error');
    } finally {
      $$('button').forEach((b) => { b.disabled = b.dataset.wasDisabled === '1'; });
      busy = false;
      refreshTargets();
    }
  }

  async function freshLayouts() {
    if (!validate()) throw new Error('Fix the highlighted fields first.');
    targets = await Host.call('targets', { target: $('#target').value });
    targetError = '';
    drawPreview();
    return layouts();
  }

  const allCells = (list) => list.reduce((out, l) => out.concat(l.cells), []);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function drawGrid() {
    const spec = readSpec();
    const output = spec.output;
    if (hostInfo.app !== 'illustrator') output.artboards = false;
    if (!output.guides && !output.cells && !output.baseline && !output.pattern && !output.overlays && !output.zones && !output.artboards) {
      throw new Error('Nothing to draw: tick Guides or Cells, or set up a baseline, drawing grid or composition.');
    }
    const grids = await freshLayouts();
    const st = style(spec);
    const saved = clone(spec);
    grids.forEach((g) => {
      g.stored = { version: 1, label: g.label, spec: saved, unit: $('#unit').value, ppi: g.ctx.ppi, mirror: !!g.ctx.mirror,
        output: Object.assign({}, output, { artboards: false }), style: st, box: g.box };
    });
    const arg = { grids, output, replace: $('#replace').checked, style: st };
    if (hostInfo.app === 'photoshop') {
      // Photoshop gets the lines as one transparent layer rendered here.
      const info = await Host.call('info');
      const png = GridRender.overlayPng(grids, { w: info.width, h: info.height },
        { color: st.color, weight: st.weight }, { baseline: output.baseline, pattern: output.pattern, overlays: output.overlays, zones: output.zones });
      if (png) {
        const path = Host.node('path');
        arg.overlayFile = path.join(Host.node('os').tmpdir(), 'portablegrid-' + Date.now() + '.png').split(path.sep).join('/');
        Host.node('fs').writeFileSync(arg.overlayFile, png);
      }
    }
    let r;
    try {
      r = await Host.call('draw', arg);
    } finally {
      if (arg.overlayFile) Host.node('fs').rmSync(arg.overlayFile, { force: true });
    }
    const parts = [];
    if (r.guides) parts.push(plural(r.guides, 'guide'));
    if (r.cells) parts.push(plural(r.cells, 'cell'));
    if (r.baselines) parts.push(plural(r.baselines, 'baseline'));
    if (r.lines) parts.push(plural(r.lines, 'line'));
    if (r.zones) parts.push(plural(r.zones, 'safe zone'));
    if (r.artboards) parts.push(plural(r.artboards, 'artboard'));
    return `Drew ${parts.join(', ') || 'nothing'}.`;
  }

  async function clearGrid() {
    const t = $('#target').value;
    const keys = hostInfo.app === 'illustrator' && (t === 'artboard' || t === 'artboards') ? targets.map((x) => x.key) : [];
    const r = await Host.call('clear', { keys });
    if (hostInfo.app === 'photoshop') return `Removed ${plural(r.removed, 'guide')} and the grid layers.`;
    return r.removed ? `Removed ${plural(r.removed, 'grid')}.` : 'No PortableGrid grid here.';
  }

  async function arrange() {
    const cells = allCells(await freshLayouts());
    const r = await Host.call('arrange', { cells, mode: $('#arrangeMode').value });
    let msg = `Placed ${plural(r.placed, 'object')}.`;
    if (r.left) msg += ` ${r.left} didn't fit: add more cells.`;
    return msg;
  }

  async function split() {
    const cells = allCells(await freshLayouts());
    if (cells.length > 400) throw new Error(`That would make ${cells.length} tiles. Use fewer columns or rows.`);
    const r = await Host.call('split', { cells, keepOriginal: $('#keepOriginal').checked });
    return `Split into ${plural(r.tiles, 'tile')}.`;
  }

  // ---------- clean-up tools ----------
  function gridLines(list) {
    const all = (k) => [...new Set(list.reduce((out, l) => out.concat(l[k]), []))].sort((a, b) => a - b);
    // Column and row edges count as grid lines even when margin guides are off.
    const v = all('vertical');
    const h = all('horizontal');
    list.forEach((l) => {
      l.cells.forEach((c) => { v.push(c.x, c.x + c.w); h.push(c.y, c.y + c.h); });
      v.push(l.content.x, l.content.x + l.content.w);
      h.push(l.content.y, l.content.y + l.content.h);
    });
    const uniq = (a) => [...new Set(a.map((n) => Math.round(n * 100) / 100))].sort((x, y) => x - y);
    return { vertical: uniq(v), horizontal: uniq(h), baselines: all('baselines') };
  }

  async function snap() {
    const lines = gridLines(await freshLayouts());
    const r = await Host.call('snap', Object.assign(lines, { mode: $('#snapMode').value }));
    return `Snapped ${plural(r.snapped, 'object')} to the grid.`;
  }

  async function check() {
    const list = await freshLayouts();
    const r = await Host.call('check', Object.assign(gridLines(list), { boxes: list.map((l) => l.box), mark: true, tolerance: 0.5 }));
    const el = $('#checkScore');
    el.textContent = r.total ? `${r.score}% on grid (${r.total - r.off} of ${r.total})` : 'Nothing to check here.';
    el.className = 'hint ' + (r.score >= 90 ? 'good' : 'bad');
    if (!r.total) return 'No objects on this artboard yet.';
    return r.off ? `${plural(r.off, 'object')} off the grid, outlined in red. Try Snap.` : 'Everything sits on the grid.';
  }

  async function clearCheck() {
    await Host.call('clearCheck');
    $('#checkScore').textContent = '';
    return 'Cleared the check marks.';
  }

  async function typeStyles() {
    const spec = readSpec();
    const body = parseFloat($('#bodySize').value) || 10;
    const base = Core.toDoc(spec.baseline.size, context()) || Math.round(body * 1.4 * 2) / 2;
    const scale = Core.typeScale(body, base, +$('#typeRatio').value);
    const r = await Host.call('typeStyles', {
      styles: scale, fonts: { headline: $('#layoutHeadFont').value.trim(), body: $('#layoutBodyFont').value.trim() },
    });
    return `Created ${plural(r.styles, 'paragraph style')} (PG Display … PG Caption) on a ${+base.toFixed(2)} pt baseline.`;
  }

  async function harmonize() {
    const body = parseFloat($('#bodySize').value) || 10;
    const spec = merge(readSpec(), Core.harmonize(body, +$('#harmonyColumns').value));
    spec.zones = extras.zones;
    spec.size = extras.size;
    writeSpec(spec);
    $('#unit').value = 'pt';
    renderPresets('');
    drawPreview();
    remember();
    status(`Harmonious grid: ${spec.baseline.size} baseline, ${spec.columns.count} columns, rows locked. Click Draw grid.`, 'ok');
  }

  async function addArtboard() {
    if (!extras.size) return '';
    const name = (presetFor($('#preset').value) || {}).name || 'Artboard';
    await Host.call('addArtboard', { w: extras.size.w, h: extras.size.h, name });
    if (hostInfo.app === 'illustrator') { $('#target').value = 'artboard'; }
    targets = [];
    await refreshTargets();
    return `Added a ${extras.size.w} × ${extras.size.h} ${hostInfo.app === 'photoshop' ? 'document' : 'artboard'}. Click Draw grid.`;
  }

  // Magazine page layouts built on the current grid (Illustrator).
  async function buildLayout() {
    const spec = readSpec();
    let grids = await freshLayouts();
    // Several artboards: each uses the grid saved on it, so pages can mix grids.
    if (grids.length > 1 && hostInfo.app === 'illustrator') {
      const stored = await Host.call('storedGrids');
      grids = grids.map((g) => {
        const s0 = stored.find((x) => x.key === g.key && x.stored);
        if (!s0) return g;
        const st = s0.stored;
        return Object.assign({ key: g.key, label: g.label }, Core.layout(g.box, st.spec, { unit: st.unit, ppi: st.ppi, pxPerDoc: 1, mirror: st.mirror }));
      });
    }
    const facing = !!spec.mirror && ['artboard', 'artboards'].includes($('#target').value);
    const content = layoutContent();
    const images = layoutImages.length ? layoutImages.slice() : brandImages();
    const bleed = Core.toDoc($('#layoutBleed').value || 0, context());
    let styles = null;
    const pages = grids.map((g) => {
      const index = g.key.startsWith('ab') ? +g.key.slice(2) : 0;
      const built = PortableGridLayouts.build(g, {
        recipe: $('#layoutRecipe').value,
        textColumns: $('#layoutColumns').value,
        side: facing ? (index % 2 === 1 ? 'left' : 'right') : null,
        page: index + 1,
        folio: $('#layoutFolio').checked,
        runningHead: $('#layoutRunning').checked,
        title: $('#layoutTitle').value.trim() || 'Magazine',
        bleed,
        content,
        images: images.splice(0, 12),
      });
      styles = styles || built.styles;
      return { key: g.key, label: g.label, elements: built.elements };
    });
    const r = await Host.call('layout', {
      pages, styles, replace: $('#replace').checked,
      fonts: { headline: $('#layoutHeadFont').value.trim(), body: $('#layoutBodyFont').value.trim() },
    });
    const noBaseline = !spec.output.baseline ? ' Tip: set a baseline grid to lock the text to it.' : '';
    let msg = `Built ${plural(r.pages, 'page')}: ${plural(r.text, 'text frame')}, ${plural(r.images + r.placed, 'picture')}${r.placed ? ` (${r.placed} placed)` : ''}.${noBaseline}`;
    if (r.overset && r.overset.length) {
      const words = r.overset.reduce((n, o) => n + o.words, 0);
      msg += ` Text doesn't fit in ${plural(r.overset.length, 'place')} (about ${words} words): marked with a red +.`;
    }
    return msg;
  }

  // ---------- layout content, PortableStudio brands ----------
  function layoutContent() {
    const own = $('#layoutText').value.trim();
    if (own) return PortableGridLayouts.parseArticle(own);
    const b = currentBrand();
    if (!b || !b.copy) return null;
    const c = b.copy;
    const body = [c.about, c.mission, c.voice, ...(c.values || []).map((v) => (typeof v === 'string' ? v : [v.title, v.text].filter(Boolean).join(': '))), c.cta]
      .filter(Boolean).join('\r');
    return { headline: c.headline || b.name, standfirst: c.subheadline || b.tagline || '', body };
  }

  function brandsDir() {
    const path = Host.node('path');
    return path.join(Host.node('os').homedir(), 'Documents', 'PortableStudio', 'Brands');
  }

  function loadBrands() {
    const fs = Host.node('fs');
    const path = Host.node('path');
    brands = [];
    try {
      for (const f of fs.readdirSync(brandsDir())) {
        if (!f.endsWith('.json')) continue;
        try { brands.push(JSON.parse(fs.readFileSync(path.join(brandsDir(), f), 'utf8'))); } catch { /* skip broken files */ }
      }
    } catch { /* PortableStudio not installed */ }
    brands.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    $('#layoutBrand').innerHTML = '<option value="">None</option>' + brands.map((b, i) => `<option value="${i}">${String(b.name).replace(/</g, '&lt;')}</option>`).join('');
    $('#layoutBrand').disabled = !brands.length;
    $('#layoutBrand').title = brands.length ? 'Fonts, title, copy and photos from a PortableStudio brand' : 'No PortableStudio brands found';
  }

  const currentBrand = () => brands[+$('#layoutBrand').value] || null;
  function brandImages() {
    const b = currentBrand();
    if (!b || !b.images) return [];
    const fs = Host.node('fs');
    return Object.keys(b.images).sort().map((k) => b.images[k]).filter((p) => p && fs.existsSync(p));
  }

  function applyBrand() {
    const b = currentBrand();
    if (!b) return;
    const font = (f) => (f && (f.ps || f.name)) || (typeof f === 'string' ? f : '');
    if (font(b.fonts && b.fonts.heading)) $('#layoutHeadFont').value = font(b.fonts.heading);
    if (font(b.fonts && b.fonts.body)) $('#layoutBodyFont').value = font(b.fonts.body);
    $('#layoutTitle').value = b.name || '';
    status(`Using ${b.name}: fonts, title${b.copy && b.copy.headline ? ', copy' : ''}${brandImages().length ? ` and ${plural(brandImages().length, 'photo')}` : ''}.`, 'ok');
  }

  function loadTextFile() {
    const p = Host.chooseFile('Choose a text file', ['txt', 'md', 'text']);
    if (!p) return;
    $('#layoutText').value = Host.node('fs').readFileSync(p, 'utf8');
    status('Loaded ' + Host.node('path').basename(p) + '.', 'ok');
  }

  function chooseImages() {
    const dir = Host.chooseFolder('Choose a folder of images');
    if (!dir) return;
    const path = Host.node('path');
    layoutImages = Host.node('fs').readdirSync(dir).filter((f) => /\.(jpe?g|png|tiff?|psd|gif|webp)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((f) => path.join(dir, f).split(path.sep).join('/'));
    $('#imagesInfo').textContent = layoutImages.length ? `${plural(layoutImages.length, 'image')} from ${path.basename(dir)}` : 'No images in that folder';
  }

  // ---------- grids saved in the document: resize sync and per-artboard grids ----------
  const sameBox = (a, b) => a && b && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.01);

  async function syncStored() {
    if (busy || !panelActive() || Host.isStalled() || hostInfo.app !== 'illustrator') return;
    let list;
    try { list = await Host.call('storedGrids'); } catch { return; }
    const active = list.find((g) => g.active);
    // Switched to an artboard that has its own grid: show that grid's settings.
    const activeIndex = targets.length && targets[0].key;
    if ($('#followArtboard').checked && active && active.stored && active.key !== lastActiveKey && $('#target').value === 'artboard') {
      writeSpec(active.stored.spec);
      $('#unit').value = active.stored.unit || $('#unit').value;
      renderPresets('');
      drawPreview();
      status(`Showing the grid saved on this artboard.`);
    }
    lastActiveKey = active ? active.key : activeIndex;
    if (!$('#autoSync').checked) return;
    const stale = list.filter((g) => g.stored && g.box && !sameBox(g.box, g.stored.box));
    if (!stale.length) return;
    busy = true;
    try {
      for (const g of stale) {
        const st = g.stored;
        const lay = Object.assign({ key: g.key, label: st.label || g.key },
          Core.layout(g.box, st.spec, { unit: st.unit, ppi: st.ppi, pxPerDoc: 1, mirror: st.mirror }));
        lay.stored = Object.assign({}, st, { box: g.box });
        await Host.call('draw', { grids: [lay], output: st.output, replace: true, style: st.style });
      }
      status(`Resized ${plural(stale.length, 'grid')} to match ${stale.length === 1 ? 'its artboard' : 'their artboards'}.`, 'ok');
    } catch (e) {
      status(e.message, 'error');
    } finally {
      busy = false;
    }
  }

  // ---------- presets: import / export ----------
  function exportPresets() {
    if (!mine.length) { status('Save a preset first: only your own presets are exported.', 'error'); return; }
    const r = window.cep.fs.showSaveDialogEx('Export presets', '', ['json'], 'PortableGrid presets.json');
    if (r.err !== 0 || !r.data) return;
    const out = r.data.endsWith('.json') ? r.data : r.data + '.json';
    Host.node('fs').writeFileSync(out, JSON.stringify({ portablegrid: 1, presets: mine }, null, 2));
    status(`Exported ${plural(mine.length, 'preset')}.`, 'ok');
  }

  function importPresets() {
    const p = Host.chooseFile('Import presets', ['json']);
    if (!p) return;
    let data;
    try { data = JSON.parse(Host.node('fs').readFileSync(p, 'utf8')); } catch { status('That file is not a PortableGrid presets file.', 'error'); return; }
    const list = Array.isArray(data) ? data : data.presets;
    if (!Array.isArray(list)) { status('That file is not a PortableGrid presets file.', 'error'); return; }
    let added = 0;
    for (const raw of list) {
      if (!raw || typeof raw.name !== 'string') continue;
      const preset = merge(DEFAULTS, raw);
      preset.name = raw.name.slice(0, 80);
      if (Array.isArray(raw.zones)) preset.zones = raw.zones;
      if (raw.size) preset.size = raw.size;
      let name = preset.name;
      for (let n = 2; mine.some((m) => m.name.toLowerCase() === name.toLowerCase()); n++) name = `${preset.name} (${n})`;
      preset.name = name;
      mine.push(preset);
      added++;
    }
    mine.sort((a, b) => a.name.localeCompare(b.name));
    saveMine();
    renderPresets($('#preset').value);
    status(`Imported ${plural(added, 'preset')}.`, 'ok');
  }

  // ---------- updates ----------
  const REPO = 'vicenet/PortableGrid';
  const newer = (a, b) => {
    const pa = String(a).replace(/^v/, '').split('.').map(Number);
    const pb = String(b).replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };

  function checkForUpdate() {
    if (!$('#checkUpdates').checked) return;
    const last = storage.get('portablegrid.updateCheck') || {};
    const show = (tag, url) => {
      const mineVersion = JSON.parse(Host.node('fs').readFileSync(`${Host.info.root}/package.json`, 'utf8')).version;
      if (!newer(tag, mineVersion) || last.dismissed === tag) return;
      const el = $('#update');
      el.innerHTML = `<span>PortableGrid ${String(tag).replace(/^v/, '')} is out.</span><button class="primary" id="getUpdate">Download</button><button id="skipUpdate">Later</button>`;
      el.hidden = false;
      $('#getUpdate').onclick = () => window.cep.util.openURLInDefaultBrowser(url);
      $('#skipUpdate').onclick = () => { el.hidden = true; storage.set('portablegrid.updateCheck', Object.assign(last, { dismissed: tag })); };
    };
    // At most once a day; the answer is cached in between.
    if (last.at && Date.now() - last.at < 864e5) { if (last.tag) show(last.tag, last.url); return; }
    const https = Host.node('https');
    const req = https.get({ host: 'api.github.com', path: `/repos/${REPO}/releases/latest`, headers: { 'User-Agent': 'PortableGrid', Accept: 'application/vnd.github+json' }, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (!j.tag_name) return;
          Object.assign(last, { at: Date.now(), tag: j.tag_name, url: j.html_url });
          storage.set('portablegrid.updateCheck', last);
          show(j.tag_name, j.html_url);
        } catch { /* offline or rate-limited: try again tomorrow */ }
      });
    });
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
  }

  // ---------- dragging margins and gutters in the preview ----------
  function bindPreviewDrag() {
    const canvas = $('#preview');
    let drag = null;
    const perUnit = () => {
      const ppi = hostInfo.ppi || 72;
      return { px: 1, pt: 72 / ppi, mm: 25.4 / ppi, cm: 2.54 / ppi, in: 1 / ppi }[$('#unit').value] || 1;
    };
    const fmt = (doc) => {
      const v = Math.max(0, doc * perUnit());
      return String(+v.toFixed($('#unit').value === 'px' || $('#unit').value === 'pt' ? 1 : 2));
    };
    const hit = (ev) => {
      if (!preview) return null;
      const r = canvas.getBoundingClientRect();
      const mx = ev.clientX - r.left;
      const my = ev.clientY - r.top;
      const { view, result } = preview;
      const X = (x) => view.ox + x * view.scale;
      const Y = (y) => view.oy + y * view.scale;
      const c = result.content;
      const b = result.box;
      const near = (a, v) => Math.abs(a - v) < 6;
      const inY = my > Y(b.y) - 6 && my < Y(b.y + b.h) + 6;
      const inX = mx > X(b.x) - 6 && mx < X(b.x + b.w) + 6;
      if (inY && near(mx, X(c.x))) return { kind: 'margin.left', axis: 'x' };
      if (inY && near(mx, X(c.x + c.w))) return { kind: 'margin.right', axis: 'x' };
      if (inX && near(my, Y(c.y))) return { kind: 'margin.top', axis: 'y' };
      if (inX && near(my, Y(c.y + c.h))) return { kind: 'margin.bottom', axis: 'y' };
      const cols = result.columns;
      for (let i = 0; i + 1 < cols.length; i++) {
        const gapA = cols[i].x + cols[i].w;
        const gapB = cols[i + 1].x;
        if (inY && (near(mx, X(gapA)) || near(mx, X(gapB)))) return { kind: 'columns.gutter', axis: 'x', centre: (gapA + gapB) / 2 };
      }
      return null;
    };
    canvas.addEventListener('pointermove', (ev) => {
      if (!drag) {
        const h = hit(ev);
        canvas.className = h ? (h.axis === 'x' ? 'drag-x' : 'drag-y') : '';
        return;
      }
      const r = canvas.getBoundingClientRect();
      const { view, result } = drag.preview;
      const docX = (ev.clientX - r.left - view.ox) / view.scale;
      const docY = (ev.clientY - r.top - view.oy) / view.scale;
      const b = result.box;
      let v;
      if (drag.kind === 'margin.left') v = docX - b.x;
      else if (drag.kind === 'margin.right') v = b.x + b.w - docX;
      else if (drag.kind === 'margin.top') v = docY - b.y;
      else if (drag.kind === 'margin.bottom') v = b.y + b.h - docY;
      else v = Math.abs(docX - drag.centre) * 2;
      // Facing pages show the mirrored margins on even pages: keep the field that is really being moved.
      const el = $(`[data-k="${drag.field}"]`);
      el.value = fmt(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    canvas.addEventListener('pointerdown', (ev) => {
      const h = hit(ev);
      if (!h) return;
      let field = h.kind;
      if (preview.result && targets[0] && readSpec().mirror && /^ab\d+$/.test(targets[0].key) && +targets[0].key.slice(2) % 2 === 1) {
        if (field === 'margin.left') field = 'margin.right';
        else if (field === 'margin.right') field = 'margin.left';
      }
      drag = Object.assign({ field, preview: { view: preview.view, result: preview.result } }, h);
      canvas.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // ---------- keyboard shortcuts ----------
  function bindKeys() {
    document.addEventListener('keydown', (ev) => {
      const mod = ev.ctrlKey || ev.metaKey;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName) && !mod && !ev.altKey;
      if (typing) return;
      const ai = hostInfo.app === 'illustrator';
      const act = (fn) => { ev.preventDefault(); fn(); };
      if (mod && ev.key === 'Enter') return act(() => run('Drawing', drawGrid));
      if (!ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (ev.key === 'Backspace') return act(() => run('Clearing', clearGrid));
      if (k === 'g') return act(() => run('Toggling', async () => {
        const r = await Host.call('toggleGrid');
        return r.visible ? 'Grid shown.' : 'Grid hidden.';
      }));
      if (ai && k === 's') return act(() => run('Snapping', snap));
      if (ai && k === 'c') return act(() => run('Checking', check));
      if (ai && k === 'l') return act(() => run('Building layout', buildLayout));
      if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') return act(() => {
        const sel = $('#preset');
        const opts = [...sel.options].filter((o) => o.value);
        const i = opts.findIndex((o) => o.value === sel.value);
        const next = opts[(i + (ev.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
        sel.value = next.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        status(next.text);
      });
    });
  }

  async function installScripts() {
    const r = await Host.call('installScripts');
    return `Added ${plural(r.files.length, 'command')} to File › Scripts (restart Illustrator to see them).`;
  }

  async function clearLayout() {
    const t = $('#target').value;
    const keys = t === 'artboard' || t === 'artboards' ? targets.map((x) => x.key) : [];
    const r = await Host.call('clearLayout', { keys });
    return r.removed ? `Removed ${plural(r.removed, 'layout')}.` : 'No PortableGrid layout here.';
  }

  async function exportTiles() {
    const cells = allCells(await freshLayouts());
    if (cells.length > 400) throw new Error(`That would export ${cells.length} files. Use fewer columns or rows.`);
    const folder = Host.chooseFolder('Choose a folder for the tiles');
    if (!folder) return 'Export cancelled.';
    const info = await Host.call('info');
    const baseName = String(info.name || 'tile').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-') || 'tile';
    const r = await Host.call('exportTiles', {
      cells, folder, baseName, format: $('#exportFormat').value, scale: parseFloat($('#exportScale').value),
    });
    Host.revealFolder(r.folder);
    return `Exported ${plural(r.files.length, 'tile')}.`;
  }

  // ---------- events ----------
  function remember() {
    storage.set(LAST_KEY, { spec: readSpec(), unit: $('#unit').value, target: $('#target').value, preset: $('#preset').value });
  }

  function onFieldChange(e) {
    const el = e.target;
    if ($('#linkMargins').checked && el.dataset.k && el.dataset.k.startsWith('margin.')) {
      $$('[data-k^="margin."]').forEach((m) => { m.value = el.value; });
    }
    if (el.dataset.k && el.id !== 'preset') {
      const p = presetFor($('#preset').value);
      // Editing a built-in preset turns it into a custom grid; your own presets stay selected so Save updates them.
      if (p && $('#preset').value[0] === 'b') renderPresets('');
    }
    drawPreview();
    remember();
  }

  function bind() {
    document.addEventListener('input', onFieldChange);
    document.addEventListener('change', onFieldChange);

    $('#linkMargins').addEventListener('change', (e) => {
      if (!e.target.checked) return;
      const top = $('[data-k="margin.top"]').value;
      $$('[data-k^="margin."]').forEach((m) => { m.value = top; });
      drawPreview();
    });

    $('#preset').addEventListener('change', (e) => {
      const p = presetFor(e.target.value);
      $('#deletePreset').disabled = !e.target.value.startsWith('m');
      if (p) writeSpec(p);
      drawPreview();
      remember();
    });

    $('#savePreset').addEventListener('click', () => {
      const current = $('#preset').value;
      const existing = current.startsWith('m') ? mine[+current.slice(1)] : null;
      const name = window.prompt('Preset name', existing ? existing.name : 'My grid');
      if (!name || !name.trim()) return;
      const preset = Object.assign({ name: name.trim() }, readSpec());
      const index = mine.findIndex((p) => p.name.toLowerCase() === preset.name.toLowerCase());
      if (index >= 0) mine[index] = preset;
      else mine.push(preset);
      mine.sort((a, b) => a.name.localeCompare(b.name));
      saveMine();
      renderPresets('m' + mine.findIndex((p) => p.name === preset.name));
      remember();
      status(`Saved preset "${preset.name}".`, 'ok');
    });

    $('#deletePreset').addEventListener('click', () => {
      const v = $('#preset').value;
      if (!v.startsWith('m')) return;
      const p = mine[+v.slice(1)];
      if (!window.confirm(`Delete the preset "${p.name}"?`)) return;
      mine.splice(+v.slice(1), 1);
      saveMine();
      renderPresets('');
      remember();
      status(`Deleted preset "${p.name}".`);
    });

    $('#target').addEventListener('change', () => { targets = []; targetError = ''; refreshTargets(); });
    $('#draw').addEventListener('click', () => run('Drawing', drawGrid));
    $('#clear').addEventListener('click', () => run('Clearing', clearGrid));
    $('#arrange').addEventListener('click', () => run('Arranging', arrange));
    $('#split').addEventListener('click', () => run('Splitting', split));
    $('#exportTiles').addEventListener('click', () => run('Exporting', exportTiles));
    $('#buildLayout').addEventListener('click', () => run('Building layout', buildLayout));
    $('#snap').addEventListener('click', () => run('Snapping', snap));
    $('#check').addEventListener('click', () => run('Checking', check));
    $('#clearCheck').addEventListener('click', () => run('Clearing', clearCheck));
    $('#typeStyles').addEventListener('click', () => run('Creating styles', typeStyles));
    $('#harmonize').addEventListener('click', () => harmonize());
    $('#addArtboard').addEventListener('click', () => run('Adding', addArtboard));
    $('#typeRatio').innerHTML = Object.entries(Core.RATIOS)
      .map(([name, v]) => `<option value="${v}"${name === 'Major third' ? ' selected' : ''}>${name} (${(+v).toFixed(3).replace(/0+$/, '')})</option>`).join('');
    $('#clearLayout').addEventListener('click', () => run('Removing layout', clearLayout));
    $('#layoutRecipe').innerHTML = Object.entries(PortableGridLayouts.RECIPES)
      .map(([v, label]) => `<option value="${v}">${label}</option>`).join('');

    $('#presetMenu').addEventListener('click', () => { $('#presetActions').hidden = !$('#presetActions').hidden; });
    $('#importPresets').addEventListener('click', importPresets);
    $('#exportPresets').addEventListener('click', exportPresets);
    $('#layoutBrand').addEventListener('change', applyBrand);
    $('#loadText').addEventListener('click', loadTextFile);
    $('#chooseImages').addEventListener('click', chooseImages);
    $('#installScripts').addEventListener('click', () => run('Installing', installScripts));
    ['autoSync', 'followArtboard', 'checkUpdates'].forEach((id) => {
      const saved = storage.get('portablegrid.' + id);
      if (saved !== null) $('#' + id).checked = saved;
      $('#' + id).addEventListener('change', (e) => storage.set('portablegrid.' + id, e.target.checked));
    });
    bindPreviewDrag();
    bindKeys();
    loadBrands();
    // Grids saved in the document follow artboard changes.
    setInterval(syncStored, 2000);

    window.addEventListener('resize', drawPreview);
    window.addEventListener('focus', () => { refreshTargets(); syncStored(); });
    document.addEventListener('mouseenter', () => { pointerInPanel = true; refreshTargets(); syncStored(); });
    document.addEventListener('mouseleave', () => { pointerInPanel = false; });
    Host.onStall((isStalled) => {
      notice(isStalled ? 'Illustrator stopped answering. Save your work and restart Illustrator to reconnect PortableGrid. (Nothing is lost: your grids are saved in the document.)'.replace(/Illustrator/g, hostInfo.app === 'photoshop' ? 'Photoshop' : 'Illustrator') : '');
      if (!isStalled) status('Reconnected.', 'ok');
    });
    // While stalled, a cheap check notices when the host answers again.
    setInterval(() => { if (Host.isStalled()) Host.call('ping').catch(() => {}); }, 10000);
    // Keep the preview in step with the active document, artboard and selection.
    setInterval(refreshTargets, 2000);
  }

  async function start() {
    try {
      const info = await Host.init();
      document.body.classList.add(info.app);
      $('#hostBadge').textContent = info.app === 'photoshop' ? 'Photoshop' : 'Illustrator';
      $('#target').innerHTML = (TARGETS[info.app] || []).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
      if (info.app === 'photoshop') $('#replaceLabel').textContent = 'Replace existing guides';
      hostInfo = Object.assign(hostInfo, await Host.call('info'));
      loadPresets();
      bind();

      const last = storage.get(LAST_KEY);
      if (last && last.spec) {
        writeSpec(last.spec);
        $('#unit').value = last.unit || 'px';
        if (last.target && TARGETS[info.app].some(([v]) => v === last.target)) $('#target').value = last.target;
        renderPresets(presetFor(last.preset) ? last.preset : '');
      } else {
        writeSpec(builtIn[0]);
        renderPresets('b0');
        if (hostInfo.unit) $('#unit').value = hostInfo.unit;
      }
      await refreshTargets();
      drawPreview();
      setTimeout(checkForUpdate, 3000);
      // The document's resolution (Photoshop) can change between documents.
      setInterval(async () => {
        if (busy || !panelActive() || Host.isStalled()) return;
        try {
          const i = await Host.call('info');
          if (i.ppi && i.ppi !== hostInfo.ppi) { hostInfo.ppi = i.ppi; drawPreview(); }
        } catch { /* no document */ }
      }, 4000);
    } catch (e) {
      notice(e.message);
    }
  }

  start();
})();
