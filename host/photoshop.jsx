// PortableGrid for Photoshop: draws guides, cell and baseline layers, and exports grid tiles.
// The panel works in pixels with the origin at the top left, like Photoshop.

(function (PG) {
    var CELLS = 'PortableGrid cells';
    var LINES = 'PortableGrid lines';

    function doc() {
        if (!app.documents.length) throw new Error('Open a document first.');
        return app.activeDocument;
    }

    // Runs fn with pixel ruler units, restoring the user's setting afterwards.
    function inPixels(fn) {
        var prev = app.preferences.rulerUnits;
        app.preferences.rulerUnits = Units.PIXELS;
        try {
            return fn();
        } finally {
            app.preferences.rulerUnits = prev;
        }
    }

    function px(v) {
        return Number(v.as ? v.as('px') : v);
    }

    function selectionBounds(d) {
        try {
            var b = d.selection.bounds;
            return [px(b[0]), px(b[1]), px(b[2]), px(b[3])];
        } catch (e) {
            return null;
        }
    }

    function removeLayer(d, name) {
        for (var i = d.layers.length - 1; i >= 0; i--) {
            if (d.layers[i].name === name) {
                d.layers[i].allLocked = false;
                d.layers[i].remove();
            }
        }
    }

    function solid(hex) {
        var c = new SolidColor();
        c.rgb = PG.hexColor(hex);
        return c;
    }

    // Fills a set of rectangles ({ x, y, w, h }) on a new layer.
    function fillLayer(d, name, rects, color, opacity) {
        var layer = d.artLayers.add();
        layer.name = name;
        var type = SelectionType.REPLACE;
        for (var i = 0; i < rects.length; i++) {
            var r = rects[i];
            if (r.w <= 0 || r.h <= 0) continue;
            var x1 = Math.round(r.x);
            var y1 = Math.round(r.y);
            var x2 = Math.max(x1 + 1, Math.round(r.x + r.w));
            var y2 = Math.max(y1 + 1, Math.round(r.y + r.h));
            d.selection.select([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], type, 0, false);
            type = SelectionType.EXTEND;
        }
        if (type === SelectionType.EXTEND) d.selection.fill(color);
        d.selection.deselect();
        layer.opacity = opacity;
        return layer;
    }

    PG.api.info = function () {
        if (!app.documents.length) return { app: 'photoshop', doc: false };
        var d = app.activeDocument;
        return inPixels(function () {
            return {
                app: 'photoshop',
                doc: true,
                name: d.name,
                ppi: Number(d.resolution),
                unit: 'px',
                width: px(d.width),
                height: px(d.height),
                selection: selectionBounds(d) ? 1 : 0
            };
        });
    };

    // target: canvas | selection
    PG.api.targets = function (arg) {
        return inPixels(function () {
            var d = doc();
            if (arg.target === 'selection') {
                var b = selectionBounds(d);
                if (!b) throw new Error('Make a selection first (for example with the Rectangular Marquee tool).');
                return [{ key: 'sel', label: 'Selection', box: { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] } }];
            }
            return [{ key: 'canvas', label: 'Canvas', box: { x: 0, y: 0, w: px(d.width), h: px(d.height) } }];
        });
    };

    // Adds a transparent PNG (rendered by the panel at the document's pixel size) as a layer.
    function placeOverlay(d, path, name, opacity) {
        var file = new File(path);
        if (!file.exists) throw new Error('Overlay image missing: ' + path);
        // File > Place Embedded, straight into this document (no second document, so it stays one
        // History step). The PNG has the canvas size, so it lands exactly on the canvas.
        var dialogs = app.displayDialogs;
        app.displayDialogs = DialogModes.NO;
        try {
            var desc = new ActionDescriptor();
            desc.putPath(charIDToTypeID('null'), file);
            desc.putEnumerated(charIDToTypeID('FTcs'), charIDToTypeID('QCSt'), charIDToTypeID('Qcsa'));
            executeAction(charIDToTypeID('Plc '), desc, DialogModes.NO);
        } finally {
            app.displayDialogs = dialogs;
        }
        // Same size as the canvas, so Photoshop places it at 100 % (layer bounds only cover the
        // drawn pixels, so they can't be used to check the scale).
        var layer = d.activeLayer;
        layer.rasterize(RasterizeType.ENTIRELAYER);
        layer.name = name;
        layer.opacity = opacity;
        return layer;
    }

    // arg: { grids: [{ vertical, horizontal, cells }], output, replace,
    //        style: { color, cellOpacity, lineOpacity }, overlayFile }
    // Baselines, drawing grids and composition lines arrive as one PNG (overlayFile).
    // Photoshop guides can't be told apart, so "replace" clears every guide in the document.
    // Runs fn as a single History step, so one undo removes the whole grid.
    function oneStep(name, fn, arg) {
        PG._step = { fn: fn, arg: arg, result: null };
        doc().suspendHistory(name, 'PortableGrid._step.result = PortableGrid._step.fn(PortableGrid._step.arg)');
        return PG._step.result;
    }

    PG.api.draw = function (arg) {
        return oneStep('PortableGrid: draw grid', drawNow, arg);
    };

    function drawNow(arg) {
        return inPixels(function () {
            var d = doc();
            var out = arg.output || {};
            var style = arg.style || {};
            var counts = { guides: 0, cells: 0, baselines: 0, lines: 0, zones: 0, artboards: 0 };
            var active = d.activeLayer;
            if (arg.replace) {
                if (out.guides) d.guides.removeAll();
                if (out.cells) removeLayer(d, CELLS);
                if (arg.overlayFile) removeLayer(d, LINES);
            }
            var cells = [];
            for (var i = 0; i < arg.grids.length; i++) {
                var g = arg.grids[i];
                if (out.guides) {
                    for (var v = 0; v < g.vertical.length; v++) d.guides.add(Direction.VERTICAL, UnitValue(g.vertical[v], 'px'));
                    for (var h = 0; h < g.horizontal.length; h++) d.guides.add(Direction.HORIZONTAL, UnitValue(g.horizontal[h], 'px'));
                    counts.guides += g.vertical.length + g.horizontal.length;
                }
                if (out.cells) cells = cells.concat(g.cells);
                if (out.baseline) counts.baselines += g.baselines.length;
                if (out.pattern) counts.lines += g.pattern.lines.length + g.pattern.dots.length;
                if (out.overlays) counts.lines += g.overlay.lines.length + g.overlay.curves.length;
                if (out.zones) counts.zones += g.zones.length;
            }
            if (cells.length) {
                fillLayer(d, CELLS, cells, solid(style.color), style.cellOpacity === undefined ? 25 : style.cellOpacity);
                counts.cells = cells.length;
            }
            if (arg.overlayFile) {
                placeOverlay(d, arg.overlayFile, LINES, style.lineOpacity === undefined ? 70 : style.lineOpacity);
            }
            if (!cells.length && !arg.overlayFile) d.activeLayer = active;
            return counts;
        });
    }

    // Platform sizes open as a new document in Photoshop. arg: { w, h, name }
    PG.api.addArtboard = function (arg) {
        return inPixels(function () {
            app.documents.add(UnitValue(arg.w, 'px'), UnitValue(arg.h, 'px'), 72, arg.name || 'Untitled', NewDocumentMode.RGB, DocumentFill.WHITE);
            return { index: 0 };
        });
    };

    PG.api.clear = function () {
        return oneStep('PortableGrid: clear grid', clearNow, {});
    };

    function clearNow() {
        var d = doc();
        var guides = d.guides.length;
        d.guides.removeAll();
        removeLayer(d, CELLS);
        removeLayer(d, LINES);
        return { removed: guides };
    }

    // Saves each cell as its own PNG or JPEG, numbered in reading order.
    // arg: { cells, folder, baseName, format: png | jpg }
    PG.api.exportTiles = function (arg) {
        return inPixels(function () {
            var d = doc();
            var folder = new Folder(arg.folder);
            if (!folder.exists && !folder.create()) throw new Error('Cannot create folder: ' + arg.folder);
            var jpg = arg.format === 'jpg';
            var opts;
            if (jpg) {
                opts = new JPEGSaveOptions();
                opts.quality = 11;
                opts.embedColorProfile = true;
            } else {
                opts = new PNGSaveOptions();
            }
            var width = String(arg.cells.length).length < 2 ? 2 : String(arg.cells.length).length;
            var files = [];
            for (var i = 0; i < arg.cells.length; i++) {
                var c = arg.cells[i];
                // A merged copy keeps memory use down and leaves the original untouched.
                var copy = d.duplicate('tile', true);
                try {
                    copy.crop([Math.round(c.x), Math.round(c.y), Math.round(c.x + c.w), Math.round(c.y + c.h)]);
                    if (jpg) copy.flatten();
                    var file = new File(folder.fsName + '/' + (arg.baseName || 'tile') + '-' + PG.pad(i + 1, width) + (jpg ? '.jpg' : '.png'));
                    copy.saveAs(file, opts, true, Extension.LOWERCASE);
                    files.push(file.fsName);
                } finally {
                    copy.close(SaveOptions.DONOTSAVECHANGES);
                }
            }
            app.activeDocument = d;
            return { files: files, folder: folder.fsName };
        });
    };
})(PortableGrid);
