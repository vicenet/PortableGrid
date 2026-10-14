/* PortableGrid page layouts: turns a grid (from core/grid.js) into magazine-style page elements.
 *
 * build(grid, options) -> { elements, styles }
 *   grid     a layout() result for one page
 *   options  { recipe, textColumns, side: 'left' | 'right' | null, page, folio, runningHead, title, bleed }
 *
 * Elements use document units, y down:
 *   { kind: 'image', role, frame }                       picture placeholder
 *   { kind: 'text', role, frame, text, thread }          area text; frames with the same thread are linked
 *   { kind: 'rule', frame }                              hairline (frame.h = 0)
 * Text roles map to paragraph styles: kicker, headline, standfirst, body, caption, pullquote, folio, runninghead.
 *
 * Everything sits on the baseline grid when the grid has one: frame tops are placed so the first line's
 * baseline lands on a grid line (the host sets "first baseline: leading").
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PortableGridLayouts = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RECIPES = {
    article: 'Article: image, headline, standfirst, body columns',
    opener: 'Feature opener: full-bleed image with headline',
    spread: 'Spread: image on the left page, story on the right',
    news: 'News page: a story in every grid module',
    photos: 'Photo grid: an image and caption in every cell',
    cover: 'Cover: masthead, full-bleed image, cover lines',
  };

  const LOREM = ('Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus '
    + 'posuere velit aliquet. Cras mattis consectetur purus sit amet fermentum. Donec ullamcorper nulla non metus auctor '
    + 'fringilla. Maecenas faucibus mollis interdum. Vestibulum id ligula porta felis euismod semper. Nullam quis risus eget '
    + 'urna mollis ornare vel eu leo. Aenean lacinia bibendum nulla sed consectetur. Curabitur blandit tempus porttitor. '
    + 'Etiam porta sem malesuada magna mollis euismod. Sed posuere consectetur est at lobortis. Morbi leo risus, porta ac '
    + 'consectetur ac, vestibulum at eros. Praesent commodo cursus magna, vel scelerisque nisl consectetur et.').split(' ');

  function words(n, seed) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(LOREM[(i + (seed || 0) * 7) % LOREM.length]);
    let s = out.join(' ').replace(/[.,]$/, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function paragraphs(count, seed) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(words(45 + ((i * 13 + seed) % 30), seed + i) + '.');
    return out.join('\r');
  }

  const round = (n) => Math.round(n * 100) / 100;
  const frame = (x, y, w, h) => ({ x: round(x), y: round(y), w: round(Math.max(0, w)), h: round(Math.max(0, h)) });

  // Type sizes from the baseline grid: body leading = one baseline, display sizes use whole multiples.
  function typeScale(b) {
    const size = (n) => Math.round(n * 2) / 2;
    return {
      body: { size: size(b / 1.3), leading: b },
      standfirst: { size: size(b * 1.1), leading: b * 2 },
      headline: { size: size(b * 2.6), leading: b * 3 },
      kicker: { size: size(b / 1.45), leading: b, caps: true },
      caption: { size: size(b / 1.6), leading: b },
      pullquote: { size: size(b * 1.6), leading: b * 2 },
      folio: { size: size(b / 1.6), leading: b },
      runninghead: { size: size(b / 1.6), leading: b, caps: true },
      masthead: { size: size(b * 6), leading: b * 6 },
    };
  }

  function build(grid, options) {
    const o = Object.assign({ recipe: 'article', textColumns: 'auto', side: null, page: 1, folio: true, runningHead: true, title: 'Magazine' }, options);
    if (!RECIPES[o.recipe]) throw new Error(`Unknown layout: ${o.recipe}`);
    // Different placeholder copy on every page.
    const P = (o.page || 1) * 3;
    const c = grid.content;
    const box = grid.box;
    const base = grid.baselines.length > 1 ? grid.baselines[1] - grid.baselines[0] : 14;
    const lines = grid.baselines.length ? grid.baselines : null;
    const styles = typeScale(base);

    // First grid line at or below y (or y itself without a baseline grid).
    const snap = (y) => {
      if (!lines) return y;
      for (const l of lines) if (l >= y - 0.01) return l;
      return lines[lines.length - 1];
    };
    // Frame for text whose first baseline sits on the grid line at or below `top`.
    const textFrame = (role, x, top, w, bottom, extra) => {
      const lead = styles[role].leading;
      const first = snap(top + lead * 0.75);
      const y = first - lead;
      // A little extra depth so a one-line frame never reports overset text.
      return Object.assign({ kind: 'text', role, frame: frame(x, y, w, Math.max(lead, bottom - y) + lead * 0.35) }, extra);
    };
    const els = [];
    const cols = grid.columns.length ? grid.columns : [{ x: c.x, w: c.w }];
    const gutter = cols.length > 1 ? cols[1].x - (cols[0].x + cols[0].w) : base;

    // Text columns are groups of grid columns (span), chosen for a comfortable 50-75 character measure.
    function textColumns(x0, x1) {
      const inRange = cols.filter((col) => col.x >= x0 - 0.01 && col.x + col.w <= x1 + 0.01);
      const n = inRange.length || 1;
      let span;
      if (o.textColumns !== 'auto') {
        const want = Math.max(1, Math.min(n, +o.textColumns));
        span = n / want;
        if (span !== Math.floor(span)) return splitEvenly(x0, x1, want);
      } else {
        const ideal = styles.body.size * 30;
        let best = n;
        for (let s = 1; s <= n; s++) {
          if (n % s) continue;
          const w = inRange[s - 1].x + inRange[s - 1].w - inRange[0].x;
          const bw = inRange[best - 1] ? inRange[best - 1].x + inRange[best - 1].w - inRange[0].x : Infinity;
          if (Math.abs(w - ideal) < Math.abs(bw - ideal)) best = s;
        }
        span = best;
      }
      if (!inRange.length) return [{ x: x0, w: x1 - x0 }];
      const out = [];
      for (let i = 0; i < inRange.length; i += span) {
        const a = inRange[i];
        const b = inRange[Math.min(inRange.length, i + span) - 1];
        out.push({ x: a.x, w: b.x + b.w - a.x });
      }
      return out;
    }
    function splitEvenly(x0, x1, n) {
      const w = (x1 - x0 - gutter * (n - 1)) / n;
      return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (w + gutter), w }));
    }
    const body = (x0, x1, top, bottom, thread, seed) => {
      textColumns(x0, x1).forEach((col, i) => {
        els.push(textFrame('body', col.x, top, col.w, bottom, { thread, text: i === 0 ? paragraphs(12, seed + P) : '' }));
      });
    };
    const image = (role, f) => els.push({ kind: 'image', role, frame: frame(f.x, f.y, f.w, f.h) });
    const bleed = (o.bleed || 0);
    // Full-bleed frames extend past the outer edges only: never across the spine of a spread.
    const inLeft = o.side === 'right' ? 0 : bleed;
    const inRight = o.side === 'left' ? 0 : bleed;
    const pageFrame = { x: box.x - inLeft, y: box.y - bleed, w: box.w + inLeft + inRight, h: box.h + bleed * 2 };
    const bottom = c.y + c.h;

    // Story and picture modules: grid rows × text-column groups, so a 12-column grid gives readable modules.
    const modules = () => {
      const rowsList = grid.rows.length ? grid.rows : [{ y: c.y, h: c.h }];
      const out = [];
      rowsList.forEach((row) => textColumns(c.x, c.x + c.w).forEach((col) => out.push({ x: col.x, y: row.y, w: col.w, h: row.h })));
      return out;
    };

    if (o.recipe === 'article') {
      const imgBottom = snap(c.y + c.h * 0.42);
      image('image', { x: c.x, y: c.y, w: c.w, h: imgBottom - c.y - base });
      els.push(textFrame('caption', c.x, imgBottom, c.w, imgBottom + base, { text: words(14, 3 + P) + '.' }));
      let y = imgBottom + base * 2;
      els.push(textFrame('kicker', c.x, y, c.w, y + base, { text: 'Feature' }));
      y += base;
      els.push(textFrame('headline', c.x, y, c.w, y + styles.headline.leading * 2, { text: words(6, 1 + P) }));
      y += styles.headline.leading * 2;
      els.push(textFrame('standfirst', c.x, y, c.w * 0.75, y + styles.standfirst.leading * 2, { text: words(22, 2 + P) + '.' }));
      y += styles.standfirst.leading * 2 + base;
      body(c.x, c.x + c.w, y, bottom, 'story', 4);
    } else if (o.recipe === 'opener') {
      image('image', pageFrame);
      const top = snap(c.y + c.h * 0.62);
      els.push(textFrame('kicker', c.x, top, c.w, top + base, { text: 'Cover story', reverse: true }));
      els.push(textFrame('headline', c.x, top + base, c.w * 0.8, top + base + styles.headline.leading * 2, { text: words(5, 6 + P), reverse: true }));
      els.push(textFrame('standfirst', c.x, top + base + styles.headline.leading * 2, c.w * 0.6, bottom, { text: words(26, 7 + P) + '.', reverse: true }));
    } else if (o.recipe === 'spread') {
      if (o.side === 'left') {
        image('image', pageFrame);
      } else {
        let y = c.y;
        els.push(textFrame('kicker', c.x, y, c.w, y + base, { text: 'Interview' }));
        y += base;
        els.push(textFrame('headline', c.x, y, c.w, y + styles.headline.leading * 3, { text: words(7, 8 + P) }));
        y += styles.headline.leading * 3;
        els.push(textFrame('standfirst', c.x, y, c.w, y + styles.standfirst.leading * 3, { text: words(30, 9 + P) + '.' }));
        y += styles.standfirst.leading * 3 + base;
        const quoteTop = snap(c.y + c.h * 0.7);
        body(c.x, c.x + c.w, y, quoteTop - base, 'story', 10);
        els.push({ kind: 'rule', frame: frame(c.x, quoteTop, c.w, 0) });
        els.push(textFrame('pullquote', c.x, quoteTop + base, c.w, bottom, { text: '“' + words(14, 11 + P) + '.”' }));
      }
    } else if (o.recipe === 'news') {
      modules().forEach((cell, i) => {
        let y = cell.y;
        const lead = i === 0;
        if (lead) {
          image('image', { x: cell.x, y, w: cell.w, h: snap(cell.y + cell.h * 0.45) - cell.y - base });
          y = snap(cell.y + cell.h * 0.45);
        }
        const hl = lead ? styles.headline.leading * 2 : styles.standfirst.leading * 2;
        els.push(textFrame(lead ? 'headline' : 'standfirst', cell.x, y, cell.w, y + hl, { text: words(lead ? 6 : 8, 20 + i) }));
        y += hl + base;
        const span = cols.filter((col) => col.x >= cell.x - 0.01 && col.x + col.w <= cell.x + cell.w + 0.01);
        const n = Math.max(1, Math.round(span.length / Math.max(1, Math.round(span.length / 2))));
        splitEvenly(cell.x, cell.x + cell.w, cell.w > styles.body.size * 40 ? Math.min(3, n) : 1).forEach((col, k) => {
          els.push(textFrame('body', col.x, y, col.w, cell.y + cell.h, { thread: 'story' + i, text: k === 0 ? paragraphs(4, 30 + i + P) : '' }));
        });
      });
    } else if (o.recipe === 'photos') {
      modules().forEach((cell, i) => {
        const capTop = cell.y + cell.h - base * 2;
        image('image', { x: cell.x, y: cell.y, w: cell.w, h: capTop - cell.y - base * 0.5 });
        els.push(textFrame('caption', cell.x, capTop, cell.w, cell.y + cell.h, { text: words(9, 40 + i + P) + '.' }));
      });
    } else if (o.recipe === 'cover') {
      image('image', pageFrame);
      els.push(textFrame('masthead', c.x, c.y, c.w, c.y + styles.masthead.leading, { text: o.title.toUpperCase(), reverse: true }));
      let y = snap(c.y + c.h * 0.35);
      const w = cols.length >= 3 ? cols[Math.floor(cols.length / 3) - 1].x + cols[Math.floor(cols.length / 3) - 1].w - c.x : c.w / 3;
      for (let i = 0; i < 3; i++) {
        els.push(textFrame('kicker', c.x, y, w, y + base, { text: words(2, 50 + i + P), reverse: true }));
        els.push(textFrame('standfirst', c.x, y + base, w, y + base + styles.standfirst.leading * 2, { text: words(7, 60 + i + P), reverse: true }));
        y += base + styles.standfirst.leading * 2 + base;
      }
    }

    // Folio and running head sit in the bottom / top margin on the outside edge.
    const outerRight = o.side !== 'left';
    if (o.folio && o.recipe !== 'cover' && !(o.recipe === 'spread' && o.side === 'left') && o.recipe !== 'opener') {
      const fw = c.w / 3;
      const fy = c.y + c.h + base;
      els.push({ kind: 'text', role: 'folio', frame: frame(outerRight ? c.x + c.w - fw : c.x, fy, fw, base * 1.5), text: String(o.page), align: outerRight ? 'right' : 'left' });
    }
    if (o.runningHead && ['article', 'news', 'photos'].includes(o.recipe) && c.y - box.y > base * 2) {
      const ry = c.y - base * 2;
      els.push({ kind: 'text', role: 'runninghead', frame: frame(c.x, ry, c.w, base * 1.5), text: o.title.toUpperCase(), align: outerRight ? 'right' : 'left' });
    }
    return { elements: els, styles };
  }

  return { RECIPES, build, typeScale };
});
