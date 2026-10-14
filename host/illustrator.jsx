// PortableGrid for Illustrator: draws layout grids (guides, cells, baselines, artboards),
// arranges artwork into grid cells, splits artwork into tiles and exports tiles as PNG.
//
// The panel works in document points with y growing downwards ({ x, y, w, h }); Illustrator's
// y axis grows upwards, so every y is negated on the way in and out.

(function (PG) {
    var LAYER = 'PortableGrid';
    var NOTE = 'portablegrid:';

    function doc() {
        if (!app.documents.length) throw new Error('Open a document first.');
        return app.activeDocument;
    }

    // All coordinates here are document coordinates, whatever the user's preference.
    function withDocCoords(fn) {
        var prev = app.coordinateSystem;
        app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
        try {
            return fn();
        } finally {
            app.coordinateSystem = prev;
        }
    }

    function rectToBox(r) {
        return { x: r[0], y: -r[1], w: r[2] - r[0], h: r[1] - r[3] };
    }

    function unitName(d) {
        switch (d.rulerUnits) {
            case RulerUnits.Millimeters: return 'mm';
            case RulerUnits.Centimeters: return 'cm';
            case RulerUnits.Inches: return 'in';
            case RulerUnits.Points: return 'pt';
            default: return 'px';
        }
    }

    function selectionItems(d) {
        var sel = d.selection;
        var out = [];
        if (!sel || typeof sel.length !== 'number') return out;
        for (var i = 0; i < sel.length; i++) {
            // Text selections (a cursor inside a text frame) are not page items.
            if (sel[i].typename && sel[i].typename !== 'TextRange') out.push(sel[i]);
        }
        return out;
    }

    function unionBounds(items) {
        var b = null;
        for (var i = 0; i < items.length; i++) {
            var v = items[i].visibleBounds;
            if (!b) b = [v[0], v[1], v[2], v[3]];
            else b = [Math.min(b[0], v[0]), Math.max(b[1], v[1]), Math.max(b[2], v[2]), Math.min(b[3], v[3])];
        }
        return b;
    }

    function gridLayer(d) {
        var layer;
        try {
            layer = d.layers.getByName(LAYER);
        } catch (e) {
            layer = d.layers.add();
            layer.name = LAYER;
        }
        layer.locked = false;
        layer.visible = true;
        layer.zOrder(ZOrderMethod.BRINGTOFRONT);
        layer.printable = false;
        return layer;
    }

    function findLayer(d) {
        try {
            return d.layers.getByName(LAYER);
        } catch (e) {
            return null;
        }
    }

    PG.api.info = function () {
        if (!app.documents.length) return { app: 'illustrator', doc: false };
        var d = app.activeDocument;
        var sel = selectionItems(d);
        return {
            app: 'illustrator',
            doc: true,
            name: d.name,
            ppi: 72,
            unit: unitName(d),
            artboards: d.artboards.length,
            activeArtboard: d.artboards.getActiveArtboardIndex(),
            selection: sel.length
        };
    };

    // Boxes to draw grids into. target: artboard | artboards | selection | each
    PG.api.targets = function (arg) {
        return withDocCoords(function () {
            var d = doc();
            var out = [];
            var target = arg.target || 'artboard';
            if (target === 'artboard' || target === 'artboards') {
                var first = target === 'artboard' ? d.artboards.getActiveArtboardIndex() : 0;
                var last = target === 'artboard' ? first : d.artboards.length - 1;
                for (var i = first; i <= last; i++) {
                    out.push({ key: 'ab' + i, label: d.artboards[i].name, box: rectToBox(d.artboards[i].artboardRect) });
                }
                return out;
            }
            var items = selectionItems(d);
            if (!items.length) throw new Error('Select some artwork first.');
            if (target === 'selection') {
                return [{ key: 'sel', label: 'Selection', box: rectToBox(unionBounds(items)) }];
            }
            for (var j = 0; j < items.length; j++) {
                out.push({ key: 'item' + j, label: items[j].name || ('Object ' + (j + 1)), box: rectToBox(items[j].visibleBounds) });
            }
            return out;
        });
    };

    function line(group, x1, y1, x2, y2) {
        var p = group.pathItems.add();
        p.setEntirePath([[x1, -y1], [x2, -y2]]);
        return p;
    }

    // Lines, dots and curves are styled paths, or guides when style.asGuides is set.
    function stylePath(p, style, color) {
        if (style.asGuides) {
            p.guides = true;
            return p;
        }
        p.filled = false;
        p.stroked = true;
        p.strokeColor = color;
        p.strokeWidth = style.weight;
        return p;
    }

    function curvePath(group, points) {
        var p = group.pathItems.add();
        for (var i = 0; i < points.length; i++) {
            var pt = p.pathPoints.add();
            pt.anchor = [points[i].anchor.x, -points[i].anchor.y];
            pt.leftDirection = [points[i].left.x, -points[i].left.y];
            pt.rightDirection = [points[i].right.x, -points[i].right.y];
            pt.pointType = PointType.SMOOTH;
        }
        return p;
    }

    function subGroup(parent, name, opacity) {
        var g = parent.groupItems.add();
        g.name = name;
        if (opacity !== undefined) g.opacity = opacity;
        return g;
    }

    function removeGrids(layer, key) {
        for (var i = layer.groupItems.length - 1; i >= 0; i--) {
            var g = layer.groupItems[i];
            var note = String(g.note || '');
            if (note.indexOf(NOTE) === 0 && (!key || note === NOTE + key)) g.remove();
        }
    }

    // arg: { grids: [{ key, label, box, content, vertical, horizontal, baselines, cells, pattern, overlay }],
    //        output: { guides, cells, baseline, pattern, overlays, artboards }, replace,
    //        style: { color, weight, lineOpacity, cellOpacity, asGuides } }
    PG.api.draw = function (arg) {
        return withDocCoords(function () {
            var d = doc();
            var out = arg.output || {};
            var style = arg.style || {};
            if (!(style.weight > 0)) style.weight = 0.5;
            var lineOpacity = style.lineOpacity === undefined ? 70 : style.lineOpacity;
            var color = PG.hexColor(style.color);
            var layer = gridLayer(d);
            var counts = { guides: 0, cells: 0, baselines: 0, lines: 0, zones: 0, artboards: 0 };

            for (var i = 0; i < arg.grids.length; i++) {
                var g = arg.grids[i];
                var box = g.box;
                if (arg.replace) removeGrids(layer, g.key);

                var group = layer.groupItems.add();
                group.name = 'Grid - ' + g.label;
                group.note = NOTE + g.key;
                if (g.stored) {
                    var tag = group.tags.add();
                    tag.name = 'portablegrid';
                    tag.value = JSON.stringify(g.stored);
                }

                if (out.cells) {
                    var cells = subGroup(group, 'Cells', style.cellOpacity === undefined ? 20 : style.cellOpacity);
                    for (var c = 0; c < g.cells.length; c++) {
                        var cell = g.cells[c];
                        var r = cells.pathItems.rectangle(-cell.y, cell.x, cell.w, cell.h);
                        r.name = 'Cell ' + (cell.row + 1) + '-' + (cell.col + 1);
                        r.stroked = false;
                        r.filled = true;
                        r.fillColor = color;
                    }
                    counts.cells += g.cells.length;
                }

                if (out.pattern && (g.pattern.lines.length || g.pattern.dots.length)) {
                    var pat = subGroup(group, 'Drawing grid', lineOpacity);
                    for (var pl = 0; pl < g.pattern.lines.length; pl++) {
                        var ln = g.pattern.lines[pl];
                        stylePath(line(pat, ln.x1, ln.y1, ln.x2, ln.y2), style, color);
                    }
                    var rad = Math.max(style.weight * 1.5, 0.75);
                    for (var dt = 0; dt < g.pattern.dots.length; dt++) {
                        var p = g.pattern.dots[dt];
                        var dot = pat.pathItems.ellipse(-(p.y - rad), p.x - rad, rad * 2, rad * 2);
                        dot.stroked = false;
                        dot.filled = true;
                        dot.fillColor = color;
                    }
                    counts.lines += g.pattern.lines.length + g.pattern.dots.length;
                }

                if (out.baseline && g.baselines.length) {
                    var base = subGroup(group, 'Baseline grid', lineOpacity);
                    for (var b = 0; b < g.baselines.length; b++) {
                        stylePath(line(base, g.content.x, g.baselines[b], g.content.x + g.content.w, g.baselines[b]), style, color);
                    }
                    counts.baselines += g.baselines.length;
                }

                if (out.overlays && (g.overlay.lines.length || g.overlay.curves.length)) {
                    var ov = subGroup(group, 'Composition', lineOpacity);
                    for (var ol = 0; ol < g.overlay.lines.length; ol++) {
                        var o = g.overlay.lines[ol];
                        stylePath(line(ov, o.x1, o.y1, o.x2, o.y2), style, color);
                    }
                    for (var oc = 0; oc < g.overlay.curves.length; oc++) stylePath(curvePath(ov, g.overlay.curves[oc]), style, color);
                    counts.lines += g.overlay.lines.length + g.overlay.curves.length;
                }

                if (out.zones && g.zones && g.zones.length) {
                    var zg = subGroup(group, 'Safe zones');
                    var red = PG.hexColor('#E5534B');
                    for (var z = 0; z < g.zones.length; z++) {
                        var zn = g.zones[z];
                        var zr = zg.pathItems.rectangle(-zn.y, zn.x, zn.w, zn.h);
                        zr.name = zn.label || 'Zone';
                        if (zn.kind === 'safe') {
                            zr.filled = false;
                            zr.stroked = true;
                            zr.strokeColor = PG.hexColor('#4CAF7A');
                            zr.strokeWidth = Math.max(1, zn.w / 400);
                            zr.strokeDashes = [8, 6];
                        } else {
                            zr.stroked = false;
                            zr.filled = true;
                            zr.fillColor = red;
                            zr.opacity = 22;
                        }
                        if (zn.label) {
                            var lab = zg.textFrames.add();
                            lab.contents = zn.label;
                            lab.textRange.characterAttributes.size = Math.max(8, Math.min(g.box.w, g.box.h) / 30);
                            lab.textRange.characterAttributes.fillColor = zn.kind === 'safe' ? PG.hexColor('#2E7D55') : PG.hexColor('#B3261E');
                            lab.left = zn.x + 8;
                            lab.top = -(zn.y + 8);
                        }
                    }
                    counts.zones = (counts.zones || 0) + g.zones.length;
                }

                if (out.guides) {
                    var guides = subGroup(group, 'Guides');
                    // Real guides take Illustrator's guide colour (set below); coloured lines keep their own.
                    var asLines = style.guideMode === 'lines';
                    var gc = PG.hexColor(style.guideColor || '#4AFFFF');
                    var mark = function (p) {
                        if (!asLines) {
                            p.guides = true;
                            return;
                        }
                        p.filled = false;
                        p.stroked = true;
                        p.strokeColor = gc;
                        p.strokeWidth = 0.5;
                    };
                    for (var v = 0; v < g.vertical.length; v++) mark(line(guides, g.vertical[v], box.y, g.vertical[v], box.y + box.h));
                    for (var h = 0; h < g.horizontal.length; h++) mark(line(guides, box.x, g.horizontal[h], box.x + box.w, g.horizontal[h]));
                    if (asLines) guides.locked = true;
                    counts.guides += g.vertical.length + g.horizontal.length;
                }

                for (var e = group.groupItems.length - 1; e >= 0; e--) {
                    if (!group.groupItems[e].pageItems.length) group.groupItems[e].remove();
                }
                if (!group.pageItems.length) group.remove();

                if (out.artboards) {
                    if (d.artboards.length + g.cells.length > 1000) throw new Error('Illustrator allows at most 1000 artboards.');
                    for (var ab = 0; ab < g.cells.length; ab++) {
                        var ce = g.cells[ab];
                        var board = d.artboards.add([ce.x, -ce.y, ce.x + ce.w, -(ce.y + ce.h)]);
                        board.name = g.label + ' ' + (ce.row + 1) + '-' + (ce.col + 1);
                    }
                    counts.artboards += g.cells.length;
                }
            }
            if (!layer.pageItems.length) layer.remove();
            // Illustrator has one guide colour for all documents: apply the chosen one.
            if (out.guides && style.guideMode !== 'lines' && style.guideColor) setGuideColor(style.guideColor);
            app.redraw();
            return counts;
        });
    };

    function setGuideColor(hex) {
        var c = PG.hexColor(hex);
        app.preferences.setRealPreference('Guide/Color/red', c.red / 255);
        app.preferences.setRealPreference('Guide/Color/green', c.green / 255);
        app.preferences.setRealPreference('Guide/Color/blue', c.blue / 255);
    }

    // ---------- snap, check, type, artboards ----------

    function nearest(v, list) {
        var best = null;
        for (var i = 0; i < list.length; i++) {
            if (best === null || Math.abs(list[i] - v) < Math.abs(best - v)) best = list[i];
        }
        return best;
    }

    // The first value in list greater than v, or fallback.
    function nextAfter(v, list, fallback) {
        var best = null;
        for (var i = 0; i < list.length; i++) {
            if (list[i] > v + 0.01 && (best === null || list[i] < best)) best = list[i];
        }
        return best === null ? fallback : best;
    }

    // Approximate first baseline (y down) of a text frame.
    function firstBaseline(tf) {
        if (tf.kind === TextType.POINTTEXT) return -tf.anchor[1];
        var top = -tf.geometricBounds[1];
        var ca = tf.textRange.characters.length ? tf.textRange.characters[0].characterAttributes : tf.textRange.characterAttributes;
        var leading = ca.autoLeading ? ca.size * 1.2 : ca.leading;
        if (tf.kind === TextType.AREATEXT && tf.firstBaseline === FirstBaselineType.BASELINELEADING) return top + leading;
        return top + ca.size * 0.8;
    }

    function edges(item) {
        var b = item.geometricBounds;
        return { l: b[0], t: -b[1], r: b[2], b: -b[3] };
    }

    // Moves (and optionally resizes) the selection onto the grid.
    // arg: { vertical, horizontal, baselines, mode: 'move' | 'fit' }
    PG.api.snap = function (arg) {
        return withDocCoords(function () {
            var d = doc();
            var items = selectionItems(d);
            if (!items.length) throw new Error('Select the objects to snap first.');
            var V = arg.vertical;
            var H = arg.horizontal.concat(arg.baselines || []);
            var moved = 0;
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                var e = edges(it);
                var isText = it.typename === 'TextFrame';
                if (arg.mode === 'fit' && !isText && V.length > 1 && H.length > 1) {
                    // Edges go to the nearest grid lines; an object never collapses to zero size.
                    var l = nearest(e.l, V);
                    var r = nearest(e.r, V);
                    if (r <= l) r = nextAfter(l, V, l + (e.r - e.l));
                    var t = nearest(e.t, H);
                    var bt = nearest(e.b, H);
                    if (bt <= t) bt = nextAfter(t, H, t + (e.b - e.t));
                    it.width = r - l;
                    it.height = bt - t;
                    e = edges(it);
                    it.translate(l - e.l, -(t - e.t));
                } else {
                    var dl = nearest(e.l, V) - e.l;
                    var dr = nearest(e.r, V) - e.r;
                    var dx = V.length ? (Math.abs(dl) <= Math.abs(dr) ? dl : dr) : 0;
                    var dy = 0;
                    if (isText && arg.baselines && arg.baselines.length) {
                        var base = firstBaseline(it);
                        dy = nearest(base, arg.baselines) - base;
                    } else if (H.length) {
                        var dt = nearest(e.t, H) - e.t;
                        var db = nearest(e.b, H) - e.b;
                        dy = Math.abs(dt) <= Math.abs(db) ? dt : db;
                    }
                    it.translate(dx, -dy);
                }
                moved++;
            }
            app.redraw();
            return { snapped: moved };
        });
    };

    var CHECK_NOTE = 'portablegrid-check';

    function clearChecks(d) {
        var layer = findLayer(d);
        if (!layer) return 0;
        var n = 0;
        for (var i = layer.groupItems.length - 1; i >= 0; i--) {
            if (String(layer.groupItems[i].note) === CHECK_NOTE) {
                layer.groupItems[i].remove();
                n++;
            }
        }
        if (!layer.pageItems.length) layer.remove();
        return n;
    }

    // Grid check: which objects sit on the grid? Marks the others with a red outline.
    // arg: { vertical, horizontal, baselines, boxes, tolerance, mark }
    PG.api.check = function (arg) {
        return withDocCoords(function () {
            var d = doc();
            clearChecks(d);
            var tol = arg.tolerance || 0.5;
            var V = arg.vertical;
            // On a baseline grid, sitting on a baseline counts as on-grid for every object.
            var H = arg.horizontal.concat(arg.baselines || []);
            var near = function (v, list) { var n = nearest(v, list); return n !== null && Math.abs(n - v) <= tol; };
            var inBoxes = function (e) {
                for (var k = 0; k < arg.boxes.length; k++) {
                    var bx = arg.boxes[k];
                    if (e.r > bx.x && e.l < bx.x + bx.w && e.b > bx.y && e.t < bx.y + bx.h) return true;
                }
                return false;
            };
            var off = [];
            var total = 0;
            for (var li = 0; li < d.layers.length; li++) {
                var layer = d.layers[li];
                if (layer.name === LAYER || !layer.visible) continue;
                for (var i = 0; i < layer.pageItems.length; i++) {
                    var it = layer.pageItems[i];
                    if (it.guides || it.hidden || it.parent !== layer) continue;
                    var e = edges(it);
                    if (!inBoxes(e)) continue;
                    total++;
                    var okX = near(e.l, V) || near(e.r, V);
                    var okY = near(e.t, H) || near(e.b, H);
                    if (it.typename === 'TextFrame' && arg.baselines && arg.baselines.length) okY = okY || near(firstBaseline(it), arg.baselines);
                    if (!(okX && okY)) off.push({ item: it, e: e, x: okX, y: okY });
                }
            }
            if (arg.mark && off.length) {
                var gl = gridLayer(d);
                var g = gl.groupItems.add();
                g.name = 'Grid check';
                g.note = CHECK_NOTE;
                var red = PG.hexColor('#E5534B');
                for (var j = 0; j < off.length; j++) {
                    var o = off[j].e;
                    var r = g.pathItems.rectangle(-(o.t - 3), o.l - 3, o.r - o.l + 6, o.b - o.t + 6);
                    r.filled = false;
                    r.stroked = true;
                    r.strokeColor = red;
                    r.strokeWidth = 1.5;
                    r.strokeDashes = [4, 3];
                    r.name = (off[j].x ? '' : 'Off columns ') + (off[j].y ? '' : 'Off rows/baselines');
                }
            }
            app.redraw();
            return { total: total, off: off.length, score: total ? Math.round(((total - off.length) / total) * 100) : 100 };
        });
    };

    PG.api.clearCheck = function () {
        return { removed: clearChecks(doc()) };
    };

    // Paragraph styles from a modular type scale. arg: { styles: [{ name, size, leading }], fonts }
    PG.api.typeStyles = function (arg) {
        var d = doc();
        var display = findFont(arg.fonts && arg.fonts.headline);
        var text = findFont(arg.fonts && arg.fonts.body);
        for (var i = 0; i < arg.styles.length; i++) {
            var s = arg.styles[i];
            var name = 'PG ' + s.name;
            var ps;
            try {
                ps = d.paragraphStyles.getByName(name);
            } catch (e) {
                ps = d.paragraphStyles.add(name);
            }
            ps.characterAttributes.size = s.size;
            ps.characterAttributes.autoLeading = false;
            ps.characterAttributes.leading = s.leading;
            var font = /^(Display|Heading)/.test(s.name) ? display : text;
            if (font) ps.characterAttributes.textFont = font;
        }
        return { styles: arg.styles.length };
    };

    // A new artboard (e.g. a platform size) to the right of the existing ones. arg: { w, h, name }
    PG.api.addArtboard = function (arg) {
        return withDocCoords(function () {
            var d = doc();
            var right = -Infinity;
            var top = 0;
            for (var i = 0; i < d.artboards.length; i++) {
                var r = d.artboards[i].artboardRect;
                if (r[2] > right) { right = r[2]; top = r[1]; }
            }
            var x = right + 100;
            var ab = d.artboards.add([x, top, x + arg.w, top - arg.h]);
            ab.name = arg.name || 'Artboard';
            d.artboards.setActiveArtboardIndex(d.artboards.length - 1);
            app.executeMenuCommand('fitin');
            return { index: d.artboards.length - 1 };
        });
    };

    // Grids drawn earlier in this document: settings (as stored) and the artboard as it is now.
    PG.api.storedGrids = function () {
        return withDocCoords(function () {
            if (!app.documents.length) return [];
            var d = app.activeDocument;
            var layer = findLayer(d);
            if (!layer) return [];
            var out = [];
            for (var i = 0; i < layer.groupItems.length; i++) {
                var g = layer.groupItems[i];
                var note = String(g.note || '');
                if (note.indexOf(NOTE) !== 0) continue;
                var stored = null;
                try {
                    stored = JSON.parse(g.tags.getByName('portablegrid').value);
                } catch (e) { /* drawn by an older version */ }
                var key = note.substring(NOTE.length);
                var box = null;
                var m = key.match(/^ab(\d+)$/);
                if (m && +m[1] < d.artboards.length) box = rectToBox(d.artboards[+m[1]].artboardRect);
                out.push({ key: key, stored: stored, box: box, active: m ? +m[1] === d.artboards.getActiveArtboardIndex() : false });
            }
            return out;
        });
    };

    // The grid lines that are actually in the document (guides and baseline lines of every grid).
    // Used by the menu scripts, which work without the panel.
    PG.api.documentLines = function () {
        return withDocCoords(function () {
            var d = doc();
            var layer = findLayer(d);
            var out = { vertical: [], horizontal: [], baselines: [] };
            if (!layer) return out;
            function walk(c, inBase) {
                for (var i = 0; i < c.pathItems.length; i++) {
                    var p = c.pathItems[i];
                    if (p.pathPoints.length !== 2) continue;
                    var a = p.pathPoints[0].anchor;
                    var b = p.pathPoints[1].anchor;
                    if (Math.abs(a[0] - b[0]) < 0.01) out.vertical.push(a[0]);
                    else if (Math.abs(a[1] - b[1]) < 0.01) (inBase ? out.baselines : out.horizontal).push(-a[1]);
                }
                for (var j = 0; j < c.groupItems.length; j++) walk(c.groupItems[j], inBase || c.groupItems[j].name === 'Baseline grid');
            }
            for (var k = 0; k < layer.groupItems.length; k++) {
                var g = layer.groupItems[k];
                if (String(g.note || '').indexOf(NOTE) === 0) walk(g, false);
            }
            return out;
        });
    };

    PG.api.toggleGrid = function () {
        var layer = findLayer(doc());
        if (!layer) return { visible: false };
        layer.visible = !layer.visible;
        return { visible: layer.visible };
    };

    // Writes small scripts into Illustrator's Scripts menu (File > Scripts), so the main actions can be
    // run, and given keyboard shortcuts through Actions, without the panel.
    PG.api.installScripts = function (arg) {
        var dir = new Folder(app.path + '/Presets/' + app.locale + '/Scripts');
        if (!dir.exists) dir = new Folder(app.path + '/Presets/en_US/Scripts');
        var made = [];
        var root = String(PG.root);
        var list = [
            ['PortableGrid - Toggle grid', "PortableGrid.api.toggleGrid({})"],
            ['PortableGrid - Snap to grid', "var l = PortableGrid.api.documentLines(); l.mode = 'move'; PortableGrid.api.snap(l)"],
            ['PortableGrid - Snap and fit to grid', "var l = PortableGrid.api.documentLines(); l.mode = 'fit'; PortableGrid.api.snap(l)"],
            ['PortableGrid - Grid check', "var l = PortableGrid.api.documentLines(); l.boxes = [{ x: -1e6, y: -1e6, w: 2e6, h: 2e6 }]; l.mark = true; var r = PortableGrid.api.check(l); alert(r.score + '% on grid (' + (r.total - r.off) + ' of ' + r.total + ')', 'PortableGrid')"]
        ];
        for (var i = 0; i < list.length; i++) {
            var file = new File(dir.fsName + '/' + list[i][0] + '.jsx');
            file.encoding = 'UTF-8';
            if (!file.open('w')) {
                throw new Error('Illustrator\'s Scripts folder is write-protected (' + dir.fsName +
                    '). Start Illustrator once with "Run as administrator", then click Install again.');
            }
            file.write('// ' + list[i][0] + ' (installed by the PortableGrid panel)\n' +
                '#target illustrator\n' +
                "$.evalFile(new File('" + root + "/host/index.jsx'));\n" +
                "PortableGrid.init('" + root + "');\n" +
                'try { ' + list[i][1] + '; } catch (e) { alert(e.message, \'PortableGrid\'); }\n');
            file.close();
            made.push(file.fsName);
        }
        return { folder: dir.fsName, files: made };
    };

    // ---------- page layouts ----------
    var LAYOUT_LAYER = 'Layout';
    var LAYOUT_NOTE = 'portablegrid-layout:';
    var STYLE_NAMES = {
        kicker: 'PG Kicker', headline: 'PG Headline', standfirst: 'PG Standfirst', body: 'PG Body', caption: 'PG Caption',
        pullquote: 'PG Pull quote', folio: 'PG Folio', runninghead: 'PG Running head', masthead: 'PG Masthead'
    };

    function findFont(name) {
        if (!name) return null;
        try {
            return app.textFonts.getByName(name);
        } catch (e) {
            return null;
        }
    }

    // Paragraph styles the layout uses: restyle them once to change every page.
    function layoutStyles(d, styles, fonts) {
        var out = {};
        var display = findFont(fonts.headline);
        var text = findFont(fonts.body);
        for (var role in STYLE_NAMES) {
            if (!STYLE_NAMES.hasOwnProperty(role) || !styles[role]) continue;
            var ps;
            try {
                ps = d.paragraphStyles.getByName(STYLE_NAMES[role]);
            } catch (e) {
                ps = d.paragraphStyles.add(STYLE_NAMES[role]);
            }
            var ca = ps.characterAttributes;
            ca.size = styles[role].size;
            ca.autoLeading = false;
            ca.leading = styles[role].leading;
            ca.capitalization = styles[role].caps ? FontCapsOption.ALLCAPS : FontCapsOption.NORMALCAPS;
            var font = (role === 'headline' || role === 'masthead' || role === 'pullquote' || role === 'standfirst') ? display : text;
            if (font) ca.textFont = font;
            ps.paragraphAttributes.hyphenation = false;
            out[role] = ps;
        }
        return out;
    }

    function placeholder(group, f) {
        var g = group.groupItems.add();
        g.name = 'Image';
        var r = g.pathItems.rectangle(-f.y, f.x, f.w, f.h);
        r.stroked = false;
        r.fillColor = PG.hexColor('#D9DEE5');
        var grey = PG.hexColor('#B8C0CC');
        var a = line(g, f.x, f.y, f.x + f.w, f.y + f.h);
        var b = line(g, f.x + f.w, f.y, f.x, f.y + f.h);
        a.stroked = b.stroked = true;
        a.filled = b.filled = false;
        a.strokeColor = b.strokeColor = grey;
        a.strokeWidth = b.strokeWidth = 0.5;
        return g;
    }

    // arg: { pages: [{ key, label, elements }], styles, fonts: { headline, body }, replace }
    PG.api.layout = function (arg) {
        return withDocCoords(function () {
            var d = doc();
            var layer;
            try {
                layer = d.layers.getByName(LAYOUT_LAYER);
            } catch (e) {
                layer = d.layers.add();
                layer.name = LAYOUT_LAYER;
            }
            layer.locked = false;
            layer.visible = true;
            var grid = findLayer(d);
            if (grid) layer.move(grid, ElementPlacement.PLACEAFTER);
            var styles = layoutStyles(d, arg.styles, arg.fonts || {});
            var white = PG.hexColor('#FFFFFF');
            var counts = { pages: 0, text: 0, images: 0, placed: 0, overset: [] };

            for (var p = 0; p < arg.pages.length; p++) {
                var page = arg.pages[p];
                if (arg.replace) {
                    for (var k = layer.groupItems.length - 1; k >= 0; k--) {
                        if (String(layer.groupItems[k].note) === LAYOUT_NOTE + page.key) layer.groupItems[k].remove();
                    }
                }
                var group = layer.groupItems.add();
                group.name = 'Layout - ' + page.label;
                group.note = LAYOUT_NOTE + page.key;
                var threads = {};
                for (var i = 0; i < page.elements.length; i++) {
                    var el = page.elements[i];
                    var f = el.frame;
                    if (el.kind === 'image') {
                        if (el.file && new File(el.file).exists) {
                            placeImage(group, f, el.file);
                            counts.placed++;
                        } else {
                            placeholder(group, f);
                        }
                        counts.images++;
                    } else if (el.kind === 'rule') {
                        var rule = line(group, f.x, f.y, f.x + f.w, f.y);
                        rule.filled = false;
                        rule.stroked = true;
                        rule.strokeColor = PG.hexColor('#000000');
                        rule.strokeWidth = 0.75;
                    } else if (el.kind === 'text') {
                        var rect = group.pathItems.rectangle(-f.y, f.x, f.w, f.h);
                        var tf = group.textFrames.areaText(rect);
                        tf.name = el.role;
                        tf.firstBaseline = FirstBaselineType.BASELINELEADING;
                        if (el.thread && threads[el.thread]) {
                            threads[el.thread].nextFrame = tf;
                        } else {
                            tf.contents = el.text || ' ';
                            if (styles[el.role]) styles[el.role].applyTo(tf.textRange, true);
                            if (el.reverse) tf.textRange.characterAttributes.fillColor = white;
                            if (el.align === 'right') tf.textRange.paragraphAttributes.justification = Justification.RIGHT;
                        }
                        if (el.thread) threads[el.thread] = tf;
                        counts.text++;
                    }
                }
                counts.pages++;
                // Text that doesn't fit: the last frame of every thread, and every unthreaded frame.
                var lastOf = {};
                var frames = [];
                for (var tfi = 0; tfi < group.textFrames.length; tfi++) frames.push(group.textFrames[tfi]);
                for (var q = 0; q < frames.length; q++) {
                    var fr = frames[q];
                    // Each story once, from its first frame (nextFrame is set even on the last frame,
                    // so it can't tell where a thread ends).
                    if (fr.kind !== TextType.AREATEXT || fr.previousFrame) continue;
                    var lost = oversetChars(fr);
                    if (lost > 0) {
                        var frs = fr.story.textFrames;
                        counts.overset.push({ page: page.label, role: fr.name, words: Math.max(1, Math.round(lost / 6)) });
                        markOverset(frs[frs.length - 1]);
                    }
                }
            }
            app.redraw();
            return counts;
        });
    };

    // Places a linked image so it fills (and is clipped to) a frame.
    function placeImage(group, f, path) {
        var item = group.placedItems.add();
        item.file = new File(path);
        var b = item.geometricBounds;
        var w = b[2] - b[0];
        var h = b[1] - b[3];
        var sc = Math.max(f.w / w, f.h / h) * 100;
        item.resize(sc, sc, true, true, true, true, 100, Transformation.CENTER);
        b = item.geometricBounds;
        item.translate(f.x + f.w / 2 - (b[0] + b[2]) / 2, -(f.y + f.h / 2) - (b[1] + b[3]) / 2);
        var clip = clipTo(item, { x: f.x, y: f.y, w: f.w, h: f.h });
        clip.name = 'Image';
        return clip;
    }

    // Characters of a story that no frame shows (0 when everything fits).
    function oversetChars(tf) {
        var story = tf.story;
        var total = story.textRange.characters.length;
        var shown = 0;
        for (var i = 0; i < story.textFrames.length; i++) {
            var fr = story.textFrames[i];
            for (var k = 0; k < fr.lines.length; k++) shown += fr.lines[k].characters.length;
        }
        // Paragraph returns are not part of any line.
        var lost = total - shown - story.paragraphs.length;
        return lost > 2 ? lost : 0;
    }

    function markOverset(tf) {
        var layer = gridLayer(tf.layer.parent);
        var g;
        for (var i = 0; i < layer.groupItems.length; i++) if (String(layer.groupItems[i].note) === CHECK_NOTE) g = layer.groupItems[i];
        if (!g) {
            g = layer.groupItems.add();
            g.name = 'Grid check';
            g.note = CHECK_NOTE;
        }
        var b = tf.geometricBounds;
        var r = g.pathItems.rectangle(b[3] + 4, b[2] - 10, 14, 14);
        r.filled = true;
        r.stroked = false;
        r.fillColor = PG.hexColor('#E5534B');
        r.name = 'Overset text';
        var plus = g.textFrames.add();
        plus.contents = '+';
        plus.textRange.characterAttributes.size = 12;
        plus.textRange.characterAttributes.fillColor = PG.hexColor('#FFFFFF');
        plus.left = b[2] - 7;
        plus.top = b[3] + 4;
    }

    PG.api.clearLayout = function (arg) {
        var d = doc();
        var layer;
        try {
            layer = d.layers.getByName(LAYOUT_LAYER);
        } catch (e) {
            return { removed: 0 };
        }
        layer.locked = false;
        var removed = 0;
        for (var i = layer.groupItems.length - 1; i >= 0; i--) {
            var note = String(layer.groupItems[i].note || '');
            if (note.indexOf(LAYOUT_NOTE) !== 0) continue;
            if (arg.keys && arg.keys.length) {
                var hit = false;
                for (var k = 0; k < arg.keys.length; k++) if (note === LAYOUT_NOTE + arg.keys[k]) hit = true;
                if (!hit) continue;
            }
            layer.groupItems[i].remove();
            removed++;
        }
        if (!layer.pageItems.length) layer.remove();
        app.redraw();
        return { removed: removed };
    };

    // Removes PortableGrid grids: those of the given keys, or all of them.
    PG.api.clear = function (arg) {
        var d = doc();
        var layer = findLayer(d);
        if (!layer) return { removed: 0 };
        layer.locked = false;
        var before = layer.groupItems.length;
        if (arg.keys && arg.keys.length) {
            for (var i = 0; i < arg.keys.length; i++) removeGrids(layer, arg.keys[i]);
        } else {
            removeGrids(layer, null);
        }
        var removed = before - layer.groupItems.length;
        if (!layer.pageItems.length) layer.remove();
        app.redraw();
        return { removed: removed };
    };

    function clipTo(item, cell) {
        var group = item.parent.groupItems.add();
        group.move(item, ElementPlacement.PLACEBEFORE);
        item.move(group, ElementPlacement.PLACEATEND);
        var mask = group.pathItems.rectangle(-cell.y, cell.x, cell.w, cell.h);
        mask.move(group, ElementPlacement.PLACEATBEGINNING);
        group.clipped = true;
        return group;
    }

    // Scales and centres an item in a cell. mode: fit (inside), fill (cover, clipped) or stretch.
    function fitInto(item, cell, mode) {
        var b = item.visibleBounds;
        var w = b[2] - b[0];
        var h = b[1] - b[3];
        if (w <= 0 || h <= 0) return item;
        var sx = cell.w / w;
        var sy = cell.h / h;
        if (mode === 'fit') sx = sy = Math.min(sx, sy);
        else if (mode === 'fill') sx = sy = Math.max(sx, sy);
        item.resize(sx * 100, sy * 100, true, true, true, true, Math.sqrt(sx * sy) * 100, Transformation.CENTER);
        b = item.visibleBounds;
        item.translate(cell.x + cell.w / 2 - (b[0] + b[2]) / 2, -(cell.y + cell.h / 2) - (b[1] + b[3]) / 2);
        return mode === 'fill' ? clipTo(item, cell) : item;
    }

    // Places the selected objects into the cells in reading order.
    // arg: { cells: [{ x, y, w, h }], mode }
    PG.api.arrange = function (arg) {
        return withDocCoords(function () {
            var d = doc();
            var items = selectionItems(d);
            if (!items.length) throw new Error('Select the objects to arrange first.');
            var entries = [];
            for (var i = 0; i < items.length; i++) {
                var v = items[i].visibleBounds;
                entries.push({ item: items[i], x: v[0], y: -v[1], h: v[1] - v[3] });
            }
            PG.readingOrder(entries, 2);
            var cells = arg.cells;
            var count = Math.min(entries.length, cells.length);
            var placed = [];
            for (var j = 0; j < count; j++) placed.push(fitInto(entries[j].item, cells[j], arg.mode || 'fit'));
            d.selection = null;
            for (var k = 0; k < placed.length; k++) placed[k].selected = true;
            app.redraw();
            return { placed: count, left: entries.length - count, emptyCells: cells.length - count };
        });
    };

    // Cuts the selection into clipped copies, one per cell (gutters become gaps).
    // arg: { cells, keepOriginal }
    PG.api.split = function (arg) {
        return withDocCoords(function () {
            var d = doc();
            var items = selectionItems(d);
            if (!items.length) throw new Error('Select the artwork to split first.');
            var source = items[0];
            if (items.length > 1) {
                source = items[0].parent.groupItems.add();
                source.move(items[0], ElementPlacement.PLACEBEFORE);
                for (var i = 0; i < items.length; i++) items[i].move(source, ElementPlacement.PLACEATEND);
            }
            var tiles = source.parent.groupItems.add();
            tiles.move(source, ElementPlacement.PLACEBEFORE);
            tiles.name = 'Tiles';
            for (var c = 0; c < arg.cells.length; c++) {
                var cell = arg.cells[c];
                var copy = source.duplicate(tiles, ElementPlacement.PLACEATEND);
                var clip = clipTo(copy, cell);
                clip.name = 'Tile ' + PG.pad(c + 1, 2);
            }
            if (arg.keepOriginal) source.hidden = true;
            else source.remove();
            d.selection = null;
            tiles.selected = true;
            app.redraw();
            return { tiles: arg.cells.length };
        });
    };

    // Exports each cell as a PNG (via a temporary artboard), numbered in reading order.
    // arg: { cells, folder, baseName, scale (percent, 100 = 72 ppi), transparent }
    PG.api.exportTiles = function (arg) {
        return withDocCoords(function () {
            var d = doc();
            var folder = new Folder(arg.folder);
            if (!folder.exists && !folder.create()) throw new Error('Cannot create folder: ' + arg.folder);
            var active = d.artboards.getActiveArtboardIndex();
            var opts = new ExportOptionsPNG24();
            opts.artBoardClipping = true;
            opts.antiAliasing = true;
            opts.transparency = arg.transparent !== false;
            opts.horizontalScale = opts.verticalScale = arg.scale || 100;
            var files = [];
            var width = String(arg.cells.length).length < 2 ? 2 : String(arg.cells.length).length;
            // The grid itself never ends up in the tiles.
            var grid = findLayer(d);
            var gridVisible = grid ? grid.visible : false;
            if (grid) grid.visible = false;
            try {
                for (var i = 0; i < arg.cells.length; i++) {
                    var c = arg.cells[i];
                    var ab = d.artboards.add([c.x, -c.y, c.x + c.w, -(c.y + c.h)]);
                    var index = d.artboards.length - 1;
                    try {
                        d.artboards.setActiveArtboardIndex(index);
                        var file = new File(folder.fsName + '/' + (arg.baseName || 'tile') + '-' + PG.pad(i + 1, width) + '.png');
                        d.exportFile(file, ExportType.PNG24, opts);
                        files.push(file.fsName);
                    } finally {
                        ab.remove();
                    }
                }
            } finally {
                if (grid) grid.visible = gridVisible;
                d.artboards.setActiveArtboardIndex(active);
            }
            return { files: files, folder: folder.fsName };
        });
    };
})(PortableGrid);
