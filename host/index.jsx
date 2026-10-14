// PortableGrid host entry point. The panel evaluates this file, then calls
// PortableGrid.init(root) and PortableGrid.call(name, jsonArg) for everything else.

var PortableGrid = (typeof PortableGrid !== 'undefined') ? PortableGrid : {};

(function (PG) {
    PG.api = PG.api || {};

    PG.hostName = function () {
        var n = String(BridgeTalk.appName).toLowerCase();
        if (n.indexOf('illustrator') === 0) return 'illustrator';
        if (n.indexOf('photoshop') === 0) return 'photoshop';
        return 'unknown';
    };

    PG.init = function (rootPath) {
        PG.root = rootPath;
        $.evalFile(new File(rootPath + '/host/lib/json.jsx'));
        var host = PG.hostName();
        if (host !== 'unknown') {
            $.evalFile(new File(rootPath + '/host/' + host + '.jsx'));
        }
        return host;
    };

    // Single entry point for the panel. Always returns {"ok":true,"data":...} or {"ok":false,"error":"..."}.
    PG.call = function (name, argJson) {
        try {
            var fn = PG.api[name];
            if (typeof fn !== 'function') throw new Error('Unknown host function: ' + name);
            var arg = argJson ? JSON.parse(argJson) : {};
            var data = fn(arg);
            return JSON.stringify({ ok: true, data: data === undefined ? null : data });
        } catch (e) {
            var msg = String(e && e.message ? e.message : e);
            if (e && e.line) msg += ' (line ' + e.line + ')';
            return JSON.stringify({ ok: false, error: msg });
        }
    };

    PG.hexColor = function (hex) {
        var c = new RGBColor();
        hex = String(hex || '#00A3FF').replace('#', '');
        c.red = parseInt(hex.substr(0, 2), 16);
        c.green = parseInt(hex.substr(2, 2), 16);
        c.blue = parseInt(hex.substr(4, 2), 16);
        return c;
    };

    // Reading order: top to bottom, then left to right. Items whose tops are within `tolerance`
    // count as the same row. Each entry needs { x, y }.
    PG.readingOrder = function (entries, tolerance) {
        entries.sort(function (a, b) {
            if (Math.abs(a.y - b.y) > tolerance) return a.y - b.y;
            return a.x - b.x;
        });
        return entries;
    };

    PG.pad = function (n, width) {
        var s = String(n);
        while (s.length < width) s = '0' + s;
        return s;
    };

    PG.api.ping = function () {
        return { app: PG.hostName(), version: String(app.version) };
    };

    PG.api.notify = function (arg) {
        alert(arg.message, arg.title || 'PortableGrid');
        return true;
    };
})(PortableGrid);
