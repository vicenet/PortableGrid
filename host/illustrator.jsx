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
            var counts = { guides: 0, cells: 0, baselines: 0, lines: 0, artboards: 0 };

            for (var i = 0; i < arg.grids.length; i++) {
                var g = arg.grids[i];
                var box = g.box;
                if (arg.replace) removeGrids(layer, g.key);

                var group = layer.groupItems.add();
                group.name = 'Grid - ' + g.label;
                group.note = NOTE + g.key;

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

                if (out.guides) {
                    var guides = subGroup(group, 'Guides');
                    for (var v = 0; v < g.vertical.length; v++) {
                        line(guides, g.vertical[v], box.y, g.vertical[v], box.y + box.h).guides = true;
                    }
                    for (var h = 0; h < g.horizontal.length; h++) {
                        line(guides, box.x, g.horizontal[h], box.x + box.w, g.horizontal[h]).guides = true;
                    }
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
            app.redraw();
            return counts;
        });
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
            d.artboards.setActiveArtboardIndex(active);
            return { files: files, folder: folder.fsName };
        });
    };
})(PortableGrid);
