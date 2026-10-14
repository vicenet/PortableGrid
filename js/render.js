/* Draws a layout result on a 2D canvas: used for the panel preview and, at full size, for the
 * Photoshop overlay layer (baselines, drawing grids and composition lines). */
const GridRender = (() => {
  // what: { background, cells, guides, baseline, pattern, overlays }
  // view: { scale, ox, oy } maps document units to canvas pixels: px = ox + x * scale
  // style: { color, weight (canvas px), cellAlpha, lineAlpha, guideColor }
  function draw(g, result, view, style, what) {
    const X = (x) => view.ox + x * view.scale;
    const Y = (y) => view.oy + y * view.scale;
    const box = result.box;
    const weight = Math.max(0.5, style.weight);
    // Crisp 1 px lines land on pixel centres.
    const crisp = (v) => (weight <= 1.01 ? Math.round(v) + 0.5 : v);

    if (what.background) {
      g.fillStyle = what.background;
      g.fillRect(X(box.x), Y(box.y), box.w * view.scale, box.h * view.scale);
    }

    if (what.cells && (result.columns.length || result.rows.length)) {
      g.globalAlpha = style.cellAlpha;
      g.fillStyle = style.color;
      result.cells.forEach((c) => g.fillRect(X(c.x), Y(c.y), c.w * view.scale, c.h * view.scale));
      g.globalAlpha = 1;
    }

    g.strokeStyle = style.color;
    g.fillStyle = style.color;
    g.lineWidth = weight;
    g.lineCap = 'butt';
    g.globalAlpha = style.lineAlpha;

    const lines = (list) => {
      g.beginPath();
      list.forEach((l) => {
        const straight = l.x1 === l.x2 || l.y1 === l.y2;
        const f = straight ? crisp : (v) => v;
        g.moveTo(f(X(l.x1)), f(Y(l.y1)));
        g.lineTo(f(X(l.x2)), f(Y(l.y2)));
      });
      g.stroke();
    };

    if (what.baseline && result.baselines.length) {
      const c = result.content;
      // Skip in the preview when lines would merge into a solid block.
      if (!what.preview || result.baselines.length * 2.5 < box.h * view.scale) {
        lines(result.baselines.map((y) => ({ x1: c.x, y1: y, x2: c.x + c.w, y2: y })));
      }
    }

    if (what.pattern) {
      lines(result.pattern.lines);
      const r = Math.max(weight * 1.5, 0.75);
      result.pattern.dots.forEach((p) => {
        g.beginPath();
        g.arc(X(p.x), Y(p.y), r, 0, Math.PI * 2);
        g.fill();
      });
    }

    if (what.overlays) {
      lines(result.overlay.lines);
      result.overlay.curves.forEach((curve) => {
        g.beginPath();
        g.moveTo(X(curve[0].anchor.x), Y(curve[0].anchor.y));
        for (let i = 1; i < curve.length; i++) {
          const a = curve[i - 1];
          const b = curve[i];
          g.bezierCurveTo(X(a.right.x), Y(a.right.y), X(b.left.x), Y(b.left.y), X(b.anchor.x), Y(b.anchor.y));
        }
        g.stroke();
      });
    }
    g.globalAlpha = 1;

    if (what.guides) {
      g.strokeStyle = style.guideColor || style.color;
      g.lineWidth = 1;
      g.beginPath();
      result.vertical.forEach((x) => { const px = Math.round(X(x)) + 0.5; g.moveTo(px, Y(box.y)); g.lineTo(px, Y(box.y + box.h)); });
      result.horizontal.forEach((y) => { const py = Math.round(Y(y)) + 0.5; g.moveTo(X(box.x), py); g.lineTo(X(box.x + box.w), py); });
      g.stroke();
    }
  }

  // Renders the line layers of several layouts into one transparent PNG of the document size.
  // Returns a Buffer, or null when there is nothing to draw.
  function overlayPng(results, size, style, what) {
    if (!what.baseline && !what.pattern && !what.overlays) return null;
    const max = 16384;
    if (size.w > max || size.h > max || size.w * size.h > 2.5e8) {
      throw new Error('This document is too large for drawn lines in Photoshop. Use guides, or a smaller document.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(size.w);
    canvas.height = Math.ceil(size.h);
    const g = canvas.getContext('2d');
    results.forEach((r) => draw(g, r, { scale: 1, ox: 0, oy: 0 }, Object.assign({}, style, { lineAlpha: 1 }), what));
    const data = canvas.toDataURL('image/png').split(',')[1];
    return Buffer.from(data, 'base64');
  }

  return { draw, overlayPng };
})();
