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
      return Object.assign({ key: t.key, label: t.label }, Core.layout(t.box, spec, ctx));
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
    if (busy || document.hidden) return;
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
    const grids = await freshLayouts();
    const facing = !!spec.mirror && ['artboard', 'artboards'].includes($('#target').value);
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
      });
      styles = styles || built.styles;
      return { key: g.key, label: g.label, elements: built.elements };
    });
    const r = await Host.call('layout', {
      pages, styles, replace: $('#replace').checked,
      fonts: { headline: $('#layoutHeadFont').value.trim(), body: $('#layoutBodyFont').value.trim() },
    });
    const noBaseline = !spec.output.baseline ? ' Tip: set a baseline grid to lock the text to it.' : '';
    return `Built ${plural(r.pages, 'page')}: ${plural(r.text, 'text frame')}, ${plural(r.images, 'image frame')}.${noBaseline}`;
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

    window.addEventListener('resize', drawPreview);
    window.addEventListener('focus', refreshTargets);
    // Keep the preview in step with the active document, artboard and selection.
    setInterval(refreshTargets, 1500);
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
      // The document's resolution (Photoshop) can change between documents.
      setInterval(async () => {
        if (busy || document.hidden) return;
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
