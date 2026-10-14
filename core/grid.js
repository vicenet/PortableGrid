/* PortableGrid layout engine: turns a grid spec into guides, cells, lines and curves.
 *
 * Works in the panel (window.PortableGridCore) and in Node (require). Boxes use document units with
 * y growing downwards: { x, y, w, h }. The host scripts convert to and from Illustrator/Photoshop coordinates.
 *
 * Lengths are numbers or strings with units: 20, "20px", "5mm", "12pt", "10%".
 *
 * Spec:
 *   margin:   { top, right, bottom, left }   mirror: true swaps left/right on even pages (facing pages)
 *   columns:  { count, gutter, size, align, pattern }
 *   rows:     { count, gutter, size, align, pattern, lock }   lock: rows and gutters in whole baselines
 *       size     fixed track width (blank = fill); with align start | center | end
 *       pattern  track sizes instead of count, e.g. "2fr 1fr 1fr", "1 0.618 1", "240px auto 30%"
 *   baseline: { size, offset }               horizontal lines every `size` inside the content area
 *   custom:   { vertical, horizontal }       extra guides inside the content area, e.g. "38.2%, 61.8%"
 *   center:   true                           guides through the middle of the box
 *   edges:    true                           guides on the content edges (margins)
 *   pattern:  { type, size }                 square | dots | isometric | triangle | hex drawing grid
 *   overlays: { thirds, phi, diagonals, armature, triangles, spiral, flipX, flipY }
 *             composition guides drawn over the content area
 *   zones:    [{ left | right, top | bottom, w, h, label, kind }]   platform safe zones (unsafe UI areas)
 */
(function (root, factory) {
  const api = factory();
  // CEP panels with Node enabled define `module` too, so set both.
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PortableGridCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UNITS = ['px', 'pt', 'mm', 'cm', 'in', '%'];
  const PHI = (1 + Math.sqrt(5)) / 2;
  const MAX_LINES = 6000;
  const MAX_DOTS = 20000;

  // Parses "12", "12mm", "5 %", "0,5in" -> { value, unit } (unit null when not given).
  function parseLength(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') return Number.isFinite(input) ? { value: input, unit: null } : null;
    const m = String(input).trim().replace(',', '.').match(/^(-?\d*\.?\d+)\s*(px|pt|mm|cm|in|%)?$/i);
    if (!m) return null;
    return { value: parseFloat(m[1]), unit: m[2] ? m[2].toLowerCase() : null };
  }

  // Converts a length to document units.
  //   ctx.unit     default unit for plain numbers
  //   ctx.ppi      document units per inch (Illustrator: 72, Photoshop: the document resolution)
  //   ctx.pxPerDoc document units per pixel (1 in both apps: Illustrator treats 1 px as 1 pt)
  //   axis         length that 100% refers to
  function toDoc(input, ctx, axis) {
    const len = parseLength(input);
    if (!len) return 0;
    const unit = len.unit || ctx.unit || 'px';
    switch (unit) {
      case 'px': return len.value * (ctx.pxPerDoc || 1);
      case 'pt': return (len.value / 72) * ctx.ppi;
      case 'mm': return (len.value / 25.4) * ctx.ppi;
      case 'cm': return (len.value / 2.54) * ctx.ppi;
      case 'in': return len.value * ctx.ppi;
      case '%': return (len.value / 100) * (axis || 0);
      default: return len.value;
    }
  }

  // Parses a track pattern: "2fr 1fr", "1 0.618 1", "240px auto 30%".
  // Returns [{ fr }] or [{ fixed }] items, or null when a token is invalid.
  function parsePattern(str) {
    const tokens = String(str || '').split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) return null;
    const out = [];
    for (const t of tokens) {
      let m;
      if (/^auto$/i.test(t)) out.push({ fr: 1 });
      else if ((m = t.match(/^(\d*\.?\d+)fr$/i))) out.push({ fr: parseFloat(m[1]) });
      else if (/^\d*\.?\d+$/.test(t)) out.push({ fr: parseFloat(t) });
      else if (parseLength(t)) out.push({ fixed: t });
      else return null;
    }
    return out;
  }

  // Splits `length` into tracks separated by `gutter`. Returns [{ start, size }] relative to the space.
  //   count/size  equal tracks; a fixed size is aligned (start | center | end) in the space
  //   pattern     mixed fixed and fractional tracks (overrides count and size)
  function tracks(length, opts, ctx) {
    const gutter = Math.max(0, opts.gutter || 0);
    const pattern = opts.pattern ? parsePattern(opts.pattern) : null;
    let sizes;
    if (pattern) {
      const fixed = pattern.map((p) => (p.fixed !== undefined ? Math.max(0, toDoc(p.fixed, ctx, length)) : 0));
      const frTotal = pattern.reduce((n, p) => n + (p.fr || 0), 0);
      const free = Math.max(0, length - gutter * (pattern.length - 1) - fixed.reduce((a, b) => a + b, 0));
      sizes = pattern.map((p, i) => (p.fr ? (free * p.fr) / frTotal : fixed[i]));
    } else {
      const count = Math.max(0, Math.floor(opts.count || 0));
      if (!count) return [];
      let track = opts.size > 0 ? opts.size : (length - gutter * (count - 1)) / count;
      if (track < 0) track = 0;
      sizes = new Array(count).fill(track);
    }
    const used = sizes.reduce((a, b) => a + b, 0) + gutter * (sizes.length - 1);
    let offset = 0;
    if (!pattern && opts.size > 0) {
      if (opts.align === 'end') offset = length - used;
      else if (opts.align !== 'start') offset = (length - used) / 2;
    }
    const out = [];
    let pos = offset;
    for (const s of sizes) {
      out.push({ start: pos, size: s });
      pos += s + gutter;
    }
    return out;
  }

  function list(str, ctx, axis) {
    if (!str) return [];
    return String(str).split(/[;,\s]+/).filter(Boolean).map((s) => toDoc(s, ctx, axis));
  }

  const round = (n) => Math.round(n * 1000) / 1000;

  function uniqueSorted(values, min, max) {
    const out = [];
    values.map(round).sort((a, b) => a - b).forEach((v) => {
      if (v < min - 0.001 || v > max + 0.001) return;
      if (!out.length || Math.abs(out[out.length - 1] - v) > 0.01) out.push(v);
    });
    return out;
  }

  // ---------- geometry helpers ----------

  // Clips the infinite line through p with direction d to the rectangle (Liang-Barsky).
  function clipLine(p, d, r) {
    let t0 = -Infinity;
    let t1 = Infinity;
    const checks = [[-d.x, p.x - r.x], [d.x, r.x + r.w - p.x], [-d.y, p.y - r.y], [d.y, r.y + r.h - p.y]];
    for (const [q, s] of checks) {
      if (Math.abs(q) < 1e-12) {
        if (s < 0) return null;
        continue;
      }
      const t = s / q;
      if (q < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
    if (t0 > t1 || !Number.isFinite(t0) || !Number.isFinite(t1)) return null;
    const a = { x: p.x + d.x * t0, y: p.y + d.y * t0 };
    const b = { x: p.x + d.x * t1, y: p.y + d.y * t1 };
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.01) return null;
    return { x1: round(a.x), y1: round(a.y), x2: round(b.x), y2: round(b.y) };
  }

  // A family of parallel lines at `angle` degrees, `spacing` apart, through `origin`, clipped to r.
  function lineFamily(r, origin, angle, spacing, out) {
    const rad = (angle * Math.PI) / 180;
    const d = { x: Math.cos(rad), y: Math.sin(rad) };
    const n = { x: -d.y, y: d.x };
    const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]
      .map(([x, y]) => (x - origin.x) * n.x + (y - origin.y) * n.y);
    const k0 = Math.ceil(Math.min(...corners) / spacing - 1e-9);
    const k1 = Math.floor(Math.max(...corners) / spacing + 1e-9);
    if (k1 - k0 + out.length > MAX_LINES) throw new Error('That drawing grid is too dense. Use a larger size.');
    for (let k = k0; k <= k1; k++) {
      const p = { x: origin.x + n.x * k * spacing, y: origin.y + n.y * k * spacing };
      const seg = clipLine(p, d, r);
      if (seg) out.push(seg);
    }
  }

  const seg = (x1, y1, x2, y2) => ({ x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) });

  // Drawing grids (graph paper): square, dots, isometric, triangle and hexagon.
  function patternGrid(r, type, size) {
    const lines = [];
    const dots = [];
    if (!type || type === 'none' || !(size > 0)) return { lines, dots };
    const o = { x: r.x, y: r.y };
    const tri = size * Math.sqrt(3) / 2;
    if (type === 'square') {
      lineFamily(r, o, 90, size, lines);
      lineFamily(r, o, 0, size, lines);
    } else if (type === 'dots') {
      const nx = Math.floor(r.w / size + 1e-9);
      const ny = Math.floor(r.h / size + 1e-9);
      if ((nx + 1) * (ny + 1) > MAX_DOTS) throw new Error('That dot grid is too dense. Use a larger size.');
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) dots.push({ x: round(r.x + i * size), y: round(r.y + j * size) });
    } else if (type === 'isometric') {
      lineFamily(r, o, 90, tri, lines);
      lineFamily(r, o, 30, tri, lines);
      lineFamily(r, o, 150, tri, lines);
    } else if (type === 'triangle') {
      lineFamily(r, o, 0, tri, lines);
      lineFamily(r, o, 60, tri, lines);
      lineFamily(r, o, 120, tri, lines);
    } else if (type === 'hex') {
      // Flat-topped hexagons with side `size`; shared edges are drawn once.
      const seen = new Set();
      const h = Math.sqrt(3) * size;
      const cols = Math.ceil(r.w / (1.5 * size)) + 1;
      const rows = Math.ceil(r.h / h) + 1;
      if (cols * rows * 3 > MAX_LINES) throw new Error('That hexagon grid is too dense. Use a larger size.');
      for (let c = 0; c <= cols; c++) {
        for (let rr = 0; rr <= rows; rr++) {
          const cx = r.x + c * 1.5 * size;
          const cy = r.y + rr * h + (c % 2 ? h / 2 : 0);
          const pts = [];
          for (let k = 0; k < 6; k++) pts.push({ x: cx + size * Math.cos((k * Math.PI) / 3), y: cy + size * Math.sin((k * Math.PI) / 3) });
          for (let k = 0; k < 6; k++) {
            const a = pts[k];
            const b = pts[(k + 1) % 6];
            const key = [a, b].map((p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`).sort().join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            const clipped = clipSegment(a, b, r);
            if (clipped) lines.push(clipped);
          }
        }
      }
    } else {
      throw new Error(`Unknown drawing grid: ${type}`);
    }
    return { lines, dots };
  }

  function clipSegment(a, b, r) {
    const line = clipLine(a, { x: b.x - a.x, y: b.y - a.y }, r);
    if (!line) return null;
    // clipLine works on the infinite line; keep the part between a and b.
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = (x, y) => ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / (len * len);
    let t1 = Math.max(0, Math.min(t(line.x1, line.y1), t(line.x2, line.y2)));
    let t2 = Math.min(1, Math.max(t(line.x1, line.y1), t(line.x2, line.y2)));
    if (t2 - t1 < 1e-6) return null;
    return seg(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1, a.x + (b.x - a.x) * t2, a.y + (b.y - a.y) * t2);
  }

  // Golden spiral in a box: quarter circles through a sequence of squares (computed in a golden
  // rectangle, then stretched to the box). Returns { lines (square edges), curve (bezier points) }.
  function goldenSpiral(box) {
    const portrait = box.h > box.w;
    // Work in a phi x 1 landscape rectangle.
    let r = { x: 0, y: 0, w: PHI, h: 1 };
    const squares = [];
    const arcs = [];
    for (let i = 0; i < 10; i++) {
      const d = i % 4;
      let sq;
      let c;
      let p0;
      let p3;
      if (d === 0) {
        const s = r.h;
        sq = { x: r.x, y: r.y, w: s, h: s };
        c = { x: r.x + s, y: r.y + s };
        p0 = { x: r.x, y: r.y + s };
        p3 = { x: r.x + s, y: r.y };
        r = { x: r.x + s, y: r.y, w: r.w - s, h: r.h };
      } else if (d === 1) {
        const s = r.w;
        sq = { x: r.x, y: r.y, w: s, h: s };
        c = { x: r.x, y: r.y + s };
        p0 = { x: r.x, y: r.y };
        p3 = { x: r.x + s, y: r.y + s };
        r = { x: r.x, y: r.y + s, w: r.w, h: r.h - s };
      } else if (d === 2) {
        const s = r.h;
        const sx = r.x + r.w - s;
        sq = { x: sx, y: r.y, w: s, h: s };
        c = { x: sx, y: r.y };
        p0 = { x: sx + s, y: r.y };
        p3 = { x: sx, y: r.y + s };
        r = { x: r.x, y: r.y, w: r.w - s, h: r.h };
      } else {
        const s = r.w;
        const sy = r.y + r.h - s;
        sq = { x: r.x, y: sy, w: s, h: s };
        c = { x: r.x + s, y: sy };
        p0 = { x: r.x + s, y: sy + s };
        p3 = { x: r.x, y: sy };
        r = { x: r.x, y: r.y, w: r.w, h: r.h - s };
      }
      squares.push(sq);
      const k = 0.5523;
      arcs.push([p0, { x: p0.x + k * (p3.x - c.x), y: p0.y + k * (p3.y - c.y) }, { x: p3.x + k * (p0.x - c.x), y: p3.y + k * (p0.y - c.y) }, p3]);
    }
    // Map from the unit golden rectangle to the box (transposed for portrait boxes).
    const map = (p) => {
      let u = p.x / PHI;
      let v = p.y;
      if (portrait) [u, v] = [v, u];
      return { x: round(box.x + u * box.w), y: round(box.y + v * box.h) };
    };
    const lines = [];
    squares.slice(0, 8).forEach((sq) => {
      const a = map({ x: sq.x, y: sq.y });
      const b = map({ x: sq.x + sq.w, y: sq.y + sq.h });
      const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
      const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
      // Only the dividing edges: the outer frame is the box itself.
      [[x1, y1, x2, y1], [x2, y1, x2, y2], [x1, y2, x2, y2], [x1, y1, x1, y2]].forEach(([ax, ay, bx, by]) => {
        const onFrame = (ax === bx && (Math.abs(ax - box.x) < 0.01 || Math.abs(ax - box.x - box.w) < 0.01))
          || (ay === by && (Math.abs(ay - box.y) < 0.01 || Math.abs(ay - box.y - box.h) < 0.01));
        if (!onFrame) lines.push(seg(ax, ay, bx, by));
      });
    });
    // Bezier path: [{ anchor, left (in), right (out) }].
    const curve = [];
    arcs.forEach((a, i) => {
      const [p0, c1, c2, p3] = a.map(map);
      if (i === 0) curve.push({ anchor: p0, left: p0, right: c1 });
      else curve[curve.length - 1].right = c1;
      curve.push({ anchor: p3, left: c2, right: p3 });
    });
    return { lines: dedupeLines(lines), curve };
  }

  function dedupeLines(lines) {
    const seen = new Set();
    return lines.filter((l) => {
      const key = [[l.x1, l.y1], [l.x2, l.y2]].map((p) => p.map((n) => Math.round(n * 10)).join(',')).sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Composition overlays drawn in box b.
  function overlays(b, o) {
    const lines = [];
    const curves = [];
    if (!o) return { lines, curves };
    const R = b.x + b.w;
    const B = b.y + b.h;
    const at = (fx, fy) => ({ x: b.x + fx * b.w, y: b.y + fy * b.h });
    const vline = (f) => lines.push(seg(b.x + f * b.w, b.y, b.x + f * b.w, B));
    const hline = (f) => lines.push(seg(b.x, b.y + f * b.h, R, b.y + f * b.h));
    if (o.thirds) [1 / 3, 2 / 3].forEach((f) => { vline(f); hline(f); });
    if (o.phi) [1 / (PHI * PHI), 1 / PHI].forEach((f) => { vline(f); hline(f); });
    if (o.diagonals || o.armature || o.triangles) {
      lines.push(seg(b.x, b.y, R, B));
      if (o.diagonals || o.armature) lines.push(seg(R, b.y, b.x, B));
    }
    if (o.armature) {
      // Rhombus through the side midpoints, the centre lines and the four reciprocals
      // (from each corner, perpendicular to the diagonal that doesn't pass through it).
      const m = [at(0.5, 0), at(1, 0.5), at(0.5, 1), at(0, 0.5)];
      for (let i = 0; i < 4; i++) lines.push(seg(m[i].x, m[i].y, m[(i + 1) % 4].x, m[(i + 1) % 4].y));
      vline(0.5);
      hline(0.5);
      const w = b.w;
      const h = b.h;
      // From the top-left corner along (h, w): hits the right side or the bottom.
      const end = (w * w) / h <= h ? { x: w, y: (w * w) / h } : { x: (h * h) / w, y: h };
      [[false, false], [true, false], [false, true], [true, true]].forEach(([fx, fy]) => {
        const sx = (x) => (fx ? b.x + w - x : b.x + x);
        const sy = (y) => (fy ? b.y + h - y : b.y + y);
        lines.push(seg(sx(0), sy(0), sx(end.x), sy(end.y)));
      });
    }
    if (o.triangles) {
      // Golden triangles: the main diagonal plus perpendiculars from the two other corners.
      const foot = (p) => {
        const dx = b.w;
        const dy = b.h;
        const t = ((p.x - b.x) * dx + (p.y - b.y) * dy) / (dx * dx + dy * dy);
        return { x: b.x + t * dx, y: b.y + t * dy };
      };
      [at(1, 0), at(0, 1)].forEach((p) => { const f = foot(p); lines.push(seg(p.x, p.y, f.x, f.y)); });
    }
    if (o.spiral) {
      const sp = goldenSpiral(b);
      sp.lines.forEach((l) => lines.push(l));
      curves.push(sp.curve);
    }
    // Everything is built for the top-left orientation; flips mirror the whole set
    // (only the spiral and the golden triangles actually change).
    if (o.flipX || o.flipY) {
      const fx = (x) => (o.flipX ? round(2 * b.x + b.w - x) : x);
      const fy = (y) => (o.flipY ? round(2 * b.y + b.h - y) : y);
      lines.forEach((l) => { l.x1 = fx(l.x1); l.x2 = fx(l.x2); l.y1 = fy(l.y1); l.y2 = fy(l.y2); });
      curves.forEach((c) => c.forEach((pt) => ['anchor', 'left', 'right'].forEach((k) => { pt[k] = { x: fx(pt[k].x), y: fy(pt[k].y) }; })));
    }
    return { lines: dedupeLines(lines), curves };
  }

  // A safe-zone rectangle: { left | right, top | bottom, w, h, label, kind }. Lengths take units or %,
  // so platform presets scale with the artboard. kind "unsafe" marks app UI; "safe" marks the safe area.
  function zone(box, z, ctx) {
    const w = toDoc(z.w, ctx, box.w);
    const h = toDoc(z.h, ctx, box.h);
    if (!(w > 0 && h > 0)) return null;
    const x = z.right !== undefined ? box.x + box.w - toDoc(z.right, ctx, box.w) - w : box.x + toDoc(z.left || 0, ctx, box.w);
    const y = z.bottom !== undefined ? box.y + box.h - toDoc(z.bottom, ctx, box.h) - h : box.y + toDoc(z.top || 0, ctx, box.h);
    return { x: round(x), y: round(y), w: round(w), h: round(h), label: z.label || '', kind: z.kind || 'unsafe' };
  }

  // A harmonious grid from one number: the body text size (pt). Leading becomes the baseline;
  // margins, gutters and rows are whole baselines.
  function harmonize(bodySize, columns) {
    const size = Math.max(4, +bodySize || 10);
    const b = Math.round(size * 1.4 * 2) / 2;
    const u = (n) => +(n * b).toFixed(2) + 'pt';
    return {
      baseline: { size: u(1), offset: '0' },
      margin: { top: u(4), right: u(3), bottom: u(5), left: u(3) },
      columns: { count: columns || 6, gutter: u(1), size: '', pattern: '' },
      rows: { count: 6, gutter: u(1), size: '', pattern: '', lock: true },
      edges: true,
    };
  }

  // A modular type scale whose leading is always a whole number of baselines.
  const RATIOS = { 'Minor third': 1.2, 'Major third': 1.25, 'Perfect fourth': 1.333, 'Augmented fourth': 1.414, 'Perfect fifth': 1.5, 'Golden ratio': PHI };
  function typeScale(bodySize, baseline, ratio) {
    const steps = [['Display', 5], ['Heading 1', 4], ['Heading 2', 3], ['Heading 3', 2], ['Heading 4', 1], ['Body', 0], ['Small', -1], ['Caption', -2]];
    return steps.map(([name, n]) => {
      const size = Math.round(bodySize * Math.pow(ratio, n) * 4) / 4;
      const leading = Math.max(1, Math.ceil((size * (n > 0 ? 1.12 : 1.3)) / baseline - 0.05)) * baseline;
      return { name, size, leading: Math.round(leading * 100) / 100 };
    });
  }

  // box: { x, y, w, h } in document units. ctx.mirror swaps left/right margins (facing pages).
  function layout(box, spec, ctx) {
    spec = spec || {};
    ctx = Object.assign({ unit: 'px', ppi: 72, pxPerDoc: 1 }, ctx);
    const m = spec.margin || {};
    let left = toDoc(m.left, ctx, box.w);
    let right = toDoc(m.right, ctx, box.w);
    if (ctx.mirror) [left, right] = [right, left];
    const top = toDoc(m.top, ctx, box.h);
    const bottom = toDoc(m.bottom, ctx, box.h);
    const content = { x: box.x + left, y: box.y + top, w: Math.max(0, box.w - left - right), h: Math.max(0, box.h - top - bottom) };

    const c = spec.columns || {};
    const r = spec.rows || {};
    const cols = tracks(content.w, {
      count: c.count, gutter: toDoc(c.gutter, ctx, content.w), size: toDoc(c.size, ctx, content.w), align: c.align, pattern: c.pattern,
    }, ctx).map((t) => ({ x: round(content.x + t.start), w: round(t.size) }));
    const baselines = [];
    const b = spec.baseline || {};
    const step = toDoc(b.size, ctx, content.h);
    if (step > 0) {
      if (content.h / step > MAX_LINES) throw new Error('That baseline grid is too dense. Use a larger size.');
      const start = content.y + toDoc(b.offset, ctx, content.h);
      for (let y = start; y <= content.y + content.h + 0.001; y += step) baselines.push(round(y));
    }

    let rows = tracks(content.h, {
      count: r.count, gutter: toDoc(r.gutter, ctx, content.h), size: toDoc(r.size, ctx, content.h), align: r.align, pattern: r.pattern,
    }, ctx).map((t) => ({ y: round(content.y + t.start), h: round(t.size) }));
    // Rows locked to the baseline grid: every row and row gutter is a whole number of baselines,
    // so text in any module lines up with text in every other module.
    if (r.lock && step > 0 && rows.length && !r.pattern) {
      const n = rows.length;
      const g = Math.round(toDoc(r.gutter, ctx, content.h) / step);
      const k = Math.floor((content.h / step - g * (n - 1)) / n);
      if (k < 1) throw new Error('Too many rows for this baseline grid. Use fewer rows or a smaller baseline.');
      const startY = content.y + toDoc(b.offset, ctx, content.h);
      rows = rows.map((_, i) => ({ y: round(startY + i * (k + g) * step), h: round(k * step) }));
    }

    const vertical = [];
    const horizontal = [];
    if (spec.edges !== false) {
      vertical.push(content.x, content.x + content.w);
      horizontal.push(content.y, content.y + content.h);
    }
    cols.forEach((col) => vertical.push(col.x, col.x + col.w));
    rows.forEach((row) => horizontal.push(row.y, row.y + row.h));
    if (spec.center) {
      vertical.push(box.x + box.w / 2);
      horizontal.push(box.y + box.h / 2);
    }
    const cu = spec.custom || {};
    list(cu.vertical, ctx, content.w).forEach((v) => vertical.push(content.x + v));
    list(cu.horizontal, ctx, content.h).forEach((v) => horizontal.push(content.y + v));

    const cells = [];
    const cellCols = cols.length ? cols : [{ x: content.x, w: content.w }];
    const cellRows = rows.length ? rows : [{ y: content.y, h: content.h }];
    cellRows.forEach((row, ri) => cellCols.forEach((col, ci) => cells.push({ x: col.x, y: row.y, w: col.w, h: row.h, row: ri, col: ci })));

    const p = spec.pattern || {};
    const pat = patternGrid(content, p.type, toDoc(p.size, ctx, Math.min(content.w, content.h)));
    const ov = overlays(content, spec.overlays);
    const zones = (spec.zones || []).map((z) => zone(box, z, ctx)).filter(Boolean);

    return {
      box,
      content: { x: round(content.x), y: round(content.y), w: round(content.w), h: round(content.h) },
      columns: cols,
      rows,
      cells,
      vertical: uniqueSorted(vertical, box.x, box.x + box.w),
      horizontal: uniqueSorted(horizontal, box.y, box.y + box.h),
      baselines: baselines.filter((y) => y >= box.y && y <= box.y + box.h),
      pattern: pat,
      overlay: ov,
      zones,
    };
  }

  // Short description for the status line, e.g. "12 columns × 1 row, 24 guides".
  function describe(result) {
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const parts = [];
    if (result.columns.length || result.rows.length) {
      parts.push(`${plural(result.columns.length || 1, 'column')} × ${plural(result.rows.length || 1, 'row')}`);
    }
    const guides = result.vertical.length + result.horizontal.length;
    if (guides) parts.push(plural(guides, 'guide'));
    if (result.baselines.length) parts.push(plural(result.baselines.length, 'baseline'));
    const lines = result.pattern.lines.length + result.overlay.lines.length + result.overlay.curves.length;
    if (lines) parts.push(plural(lines, 'line'));
    if (result.pattern.dots.length) parts.push(plural(result.pattern.dots.length, 'dot'));
    if (result.zones.length) parts.push(plural(result.zones.length, 'safe zone'));
    return parts.join(', ') || 'Nothing to draw';
  }

  return { UNITS, PHI, RATIOS, parseLength, parsePattern, toDoc, tracks, layout, describe, goldenSpiral, patternGrid, overlays, harmonize, typeScale };
});
