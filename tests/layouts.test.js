// Page layouts: every recipe builds sane, baseline-aligned elements inside the page.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../core/grid');
const L = require('../core/layouts');
const presets = require('../config/presets.json');

const ctx = { unit: 'px', ppi: 72 };
const page = { x: 0, y: 0, w: 595, h: 842 };
const grids = {
  magazine: G.layout(page, presets.find((p) => p.name.startsWith('Magazine')), ctx),
  modular: G.layout(page, Object.assign({}, presets.find((p) => p.name.startsWith('Modular')), { baseline: { size: '12pt' } }), ctx),
  plain: G.layout(page, { margin: { top: 40, right: 40, bottom: 40, left: 40 }, columns: { count: 3, gutter: 12 } }, ctx),
};

for (const recipe of Object.keys(L.RECIPES)) {
  for (const [gname, grid] of Object.entries(grids)) {
    test(`${recipe} on the ${gname} grid`, () => {
      for (const side of ['left', 'right', null]) {
        const { elements, styles } = L.build(grid, { recipe, side, page: 3, bleed: 9 });
        assert.ok(elements.length > 0);
        for (const el of elements) {
          const f = el.frame;
          assert.ok(f.w >= 0 && f.h >= 0, `${el.role} has a negative size`);
          assert.ok(f.x >= -9.01 && f.x + f.w <= page.w + 9.01 && f.y >= -9.01 && f.y + f.h <= page.h + 9.01, `${el.role} leaves the page`);
          if (el.kind === 'text') assert.ok(styles[el.role], `no style for ${el.role}`);
        }
        // Text frames put their first baseline on a grid line.
        if (grid.baselines.length) {
          for (const el of elements.filter((e) => e.kind === 'text' && !['folio', 'runninghead'].includes(e.role))) {
            const first = el.frame.y + styles[el.role].leading;
            assert.ok(grid.baselines.some((b) => Math.abs(b - first) < 0.05), `${recipe} ${el.role} is off the baseline grid`);
          }
        }
      }
    });
  }
}

test('spreads never bleed across the spine', () => {
  const left = L.build(grids.magazine, { recipe: 'spread', side: 'left', bleed: 9 }).elements.find((e) => e.kind === 'image');
  assert.equal(left.frame.x + left.frame.w, page.w);
  const opener = L.build(grids.magazine, { recipe: 'opener', side: 'right', bleed: 9 }).elements.find((e) => e.kind === 'image');
  assert.equal(opener.frame.x, 0);
});

test('modules group grid columns into readable story widths', () => {
  const news = L.build(grids.magazine, { recipe: 'news' }).elements.filter((e) => e.role === 'headline' || e.role === 'standfirst');
  assert.ok(news.length <= 6, `${news.length} stories on a 12-column page`);
});
