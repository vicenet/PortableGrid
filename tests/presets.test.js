// Every built-in preset is valid and produces something to draw.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../core/grid');
const presets = require('../config/presets.json');

const pages = [{ x: 0, y: 0, w: 595, h: 842 }, { x: 0, y: 0, w: 1440, h: 900 }, { x: 0, y: 0, w: 1080, h: 1080 }];

for (const p of presets) {
  test(`preset "${p.name}"`, () => {
    assert.ok(p.name && p.group, 'needs a name and a group');
    for (const box of pages) {
      const r = G.layout(box, p, { unit: 'px', ppi: 72 });
      const things = r.vertical.length + r.horizontal.length + r.baselines.length + r.pattern.lines.length
        + r.pattern.dots.length + r.overlay.lines.length + r.overlay.curves.length + r.zones.length + (r.columns.length || r.rows.length ? r.cells.length : 0);
      assert.ok(things > 0, `draws nothing on ${box.w}x${box.h}`);
      for (const c of r.cells) assert.ok(c.w >= 0 && c.h >= 0, 'negative cell');
    }
  });
}

test('panel scripts parse', () => {
  const fs = require('node:fs');
  for (const f of ['js/panel.js', 'js/render.js', 'js/bridge.js']) {
    assert.doesNotThrow(() => new Function(fs.readFileSync(require('node:path').join(__dirname, '..', f), 'utf8')), f);
  }
});
