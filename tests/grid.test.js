// Layout engine: every grid type, units and edge cases.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../core/grid');

const box = { x: 0, y: 0, w: 1000, h: 500 };
const ctx = { unit: 'px', ppi: 72 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg || ''} expected ${b}, got ${a}`);

test('units convert to document units', () => {
  near(G.toDoc('1in', { ppi: 72 }), 72);
  near(G.toDoc('25.4mm', { ppi: 300 }), 300);
  near(G.toDoc('12pt', { ppi: 300 }), 50);
  near(G.toDoc('10%', ctx, 400), 40);
  near(G.toDoc('2,5', { unit: 'cm', ppi: 72 }), 70.866);
  assert.equal(G.toDoc('abc', ctx), 0);
});

test('column grid: equal columns with gutters and margins', () => {
  const r = G.layout(box, { margin: { left: 40, right: 40 }, columns: { count: 12, gutter: 20 } }, ctx);
  assert.equal(r.columns.length, 12);
  near(r.columns[0].x, 40);
  near(r.columns[0].w, (920 - 220) / 12);
  near(r.columns[11].x + r.columns[11].w, 960);
  assert.equal(r.cells.length, 12);
});

test('modular grid: columns x rows cells in reading order', () => {
  const r = G.layout(box, { columns: { count: 4, gutter: 10 }, rows: { count: 3, gutter: 10 } }, ctx);
  assert.equal(r.cells.length, 12);
  assert.deepEqual([r.cells[1].row, r.cells[1].col], [0, 1]);
  assert.deepEqual([r.cells[4].row, r.cells[4].col], [1, 0]);
});

test('fixed-width columns are aligned (web container)', () => {
  const c = G.layout(box, { columns: { count: 2, size: 100, gutter: 20 } }, ctx);
  near(c.columns[0].x, 390);
  const s = G.layout(box, { columns: { count: 2, size: 100, gutter: 20, align: 'start' } }, ctx);
  near(s.columns[0].x, 0);
  const e = G.layout(box, { columns: { count: 2, size: 100, gutter: 20, align: 'end' } }, ctx);
  near(e.columns[1].x + e.columns[1].w, 1000);
});

test('hierarchical grid: track patterns with fr, fixed and auto', () => {
  const r = G.layout(box, { columns: { pattern: '2fr 1fr 1fr', gutter: 0 } }, ctx);
  assert.deepEqual(r.columns.map((c) => c.w), [500, 250, 250]);
  const m = G.layout(box, { columns: { pattern: '200px auto 10%', gutter: 50 } }, ctx);
  assert.deepEqual(m.columns.map((c) => c.w), [200, 600, 100]);
  const phi = G.layout(box, { columns: { pattern: '1 0.618 1' } }, ctx);
  near(phi.columns[1].w / phi.columns[0].w, 0.618);
  assert.equal(G.parsePattern('2fr nonsense'), null);
});

test('baseline grid starts at the content top plus offset', () => {
  const r = G.layout(box, { margin: { top: 20, bottom: 20 }, baseline: { size: 10, offset: 5 } }, ctx);
  near(r.baselines[0], 25);
  near(r.baselines[1] - r.baselines[0], 10);
  assert.ok(r.baselines[r.baselines.length - 1] <= 480);
});

test('facing pages mirror the left and right margins', () => {
  const spec = { margin: { left: 10, right: 50 } };
  near(G.layout(box, spec, ctx).content.x, 10);
  near(G.layout(box, spec, { ...ctx, mirror: true }).content.x, 50);
});

test('custom, centre and margin guides', () => {
  const r = G.layout(box, { margin: { left: 100, right: 100 }, center: true, custom: { vertical: '50%, 10px' } }, ctx);
  assert.deepEqual(r.vertical, [100, 110, 500, 900]);
  const none = G.layout(box, { edges: false }, ctx);
  assert.deepEqual(none.vertical, []);
});

test('drawing grids: square, dots, isometric, triangle, hex', () => {
  const sq = G.layout(box, { pattern: { type: 'square', size: 100 } }, ctx).pattern;
  assert.equal(sq.lines.length, 11 + 6);
  const dots = G.layout(box, { pattern: { type: 'dots', size: 100 } }, ctx).pattern;
  assert.equal(dots.dots.length, 11 * 6);
  for (const type of ['isometric', 'triangle', 'hex']) {
    const p = G.layout(box, { pattern: { type, size: 50 } }, ctx).pattern;
    assert.ok(p.lines.length > 20, type);
    for (const l of p.lines) {
      for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
        assert.ok(x >= -0.01 && x <= 1000.01 && y >= -0.01 && y <= 500.01, `${type} line outside the box`);
      }
    }
  }
  const iso = G.layout(box, { pattern: { type: 'isometric', size: 50 } }, ctx).pattern;
  const angles = new Set(iso.lines.map((l) => Math.round((Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 180) / Math.PI + 360) % 180));
  assert.deepEqual([...angles].sort((a, b) => a - b), [30, 90, 150]);
  assert.throws(() => G.layout(box, { pattern: { type: 'dots', size: 0.5 } }, ctx), /too dense/);
});

test('composition overlays', () => {
  const o = (overlays) => G.layout(box, { overlays }, ctx).overlay;
  assert.equal(o({ thirds: true }).lines.length, 4);
  const phi = o({ phi: true }).lines.map((l) => l.x1).filter((x, i, a) => a.indexOf(x) === i);
  near(phi[0], 381.966);
  assert.equal(o({ diagonals: true }).lines.length, 2);
  assert.equal(o({ armature: true }).lines.length, 2 + 4 + 2 + 4);
  assert.equal(o({ triangles: true }).lines.length, 3);
  const spiral = o({ spiral: true });
  assert.equal(spiral.curves.length, 1);
  const pts = spiral.curves[0];
  near(pts[0].anchor.x, 0);
  near(pts[0].anchor.y, 500);
  const flipped = o({ spiral: true, flipX: true }).curves[0];
  near(flipped[0].anchor.x, 1000);
  const portrait = G.layout({ x: 0, y: 0, w: 500, h: 1000 }, { overlays: { spiral: true } }, ctx).overlay.curves[0];
  for (const p of portrait) assert.ok(p.anchor.x <= 500.01 && p.anchor.y <= 1000.01);
});

test('describe summarises the result', () => {
  const r = G.layout(box, { columns: { count: 3 }, rows: { count: 2 } }, ctx);
  assert.match(G.describe(r), /3 columns × 2 rows/);
});

test('rows locked to the baseline are whole baselines', () => {
  const r = G.layout({ x: 0, y: 0, w: 600, h: 800 }, { margin: { top: 40, bottom: 40 }, baseline: { size: 12 }, rows: { count: 5, gutter: 12, lock: true } }, ctx);
  for (const row of r.rows) {
    near((row.y - 40) % 12, 0, 'row top on a baseline');
    near(row.h % 12, 0, 'row height in baselines');
  }
  near(r.rows[1].y - (r.rows[0].y + r.rows[0].h), 12, 'gutter');
  assert.throws(() => G.layout(box, { baseline: { size: 100 }, rows: { count: 20, lock: true } }, ctx), /Too many rows/);
});

test('safe zones anchor to edges and scale with %', () => {
  const r = G.layout({ x: 0, y: 0, w: 1080, h: 1920 }, { zones: [{ top: 0, left: 0, w: '100%', h: 250, label: 'top' }, { bottom: 0, right: 0, w: 120, h: '50%' }] }, ctx);
  assert.deepEqual(r.zones[0], { x: 0, y: 0, w: 1080, h: 250, label: 'top', kind: 'unsafe' });
  assert.deepEqual([r.zones[1].x, r.zones[1].y, r.zones[1].h], [960, 960, 960]);
});

test('harmonize builds a grid from the body size', () => {
  const spec = G.harmonize(10, 6);
  assert.equal(spec.baseline.size, '14pt');
  assert.equal(spec.margin.top, '56pt');
  const r = G.layout({ x: 0, y: 0, w: 595, h: 842 }, spec, { unit: 'pt', ppi: 72 });
  assert.equal(r.columns.length, 6);
  for (const row of r.rows) near((row.y - 56) % 14, 0);
});

test('type scale leading is a whole number of baselines', () => {
  const t = G.typeScale(10, 14, 1.25);
  assert.equal(t.find((x) => x.name === 'Body').size, 10);
  for (const s of t) near((s.leading / 14) % 1, 0, s.name);
  assert.ok(t[0].size > t[1].size);
});
