/* Talks to Illustrator/Photoshop through CEP's evalScript, plus a few CEP/Node helpers. */
const Host = (() => {
  const cep = window.__adobe_cep__;
  const APPS = { ILST: 'illustrator', PHXS: 'photoshop', PHSP: 'photoshop' };
  const node = typeof require === 'function' ? require : null;
  const info = { app: null, root: null };

  // One script at a time: overlapping evalScript calls can make Illustrator drop a reply, and every later
  // call then waits behind it. Each call also has a time limit, so the panel never hangs on a lost reply.
  let queue = Promise.resolve();
  let stalled = false;
  const listeners = [];
  const stalledMessage = () => {
    const app = info.app === 'photoshop' ? 'Photoshop' : 'Illustrator';
    return `${app} stopped answering PortableGrid. Save your work, then restart ${app} to reconnect.`;
  };

  function evalRaw(script, timeoutMs = 30000) {
    const run = () => new Promise((resolve, reject) => {
      if (!cep) return reject(new Error('Not running inside Illustrator or Photoshop.'));
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        stalled = true;
        listeners.forEach((fn) => fn(true));
        reject(new Error(stalledMessage()));
      }, timeoutMs);
      cep.evalScript(script, (result) => {
        if (done) return; // answered after the time limit: too late, but the connection works again
        done = true;
        clearTimeout(timer);
        if (stalled) {
          stalled = false;
          listeners.forEach((fn) => fn(false));
        }
        if (result === 'EvalScript error.') {
          reject(new Error('Host script error - check the .jsx files for a syntax error.'));
        } else {
          resolve(result);
        }
      });
    });
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  // Called with true when the host stops answering, and false when it answers again.
  const onStall = (fn) => listeners.push(fn);
  const isStalled = () => stalled;

  function extensionRoot() {
    const url = decodeURI(cep.getSystemPath('extension'));
    // Windows: file:///D:/x -> D:/x   macOS: file:///Users/x -> /Users/x
    return process.platform === 'win32' ? url.replace(/^file:\/{3}/, '') : url.replace(/^file:\/{2}/, '');
  }

  async function init() {
    if (!cep) throw new Error('Not running inside Illustrator or Photoshop.');
    if (!node) throw new Error('Node.js is disabled for this panel (check CSXS/manifest.xml).');
    info.app = APPS[JSON.parse(cep.getHostEnvironment()).appName] || 'unknown';
    info.root = extensionRoot().replace(/\\/g, '/');
    const hostApp = await evalRaw(
      `$.evalFile(${JSON.stringify(info.root + '/host/index.jsx')}); PortableGrid.init(${JSON.stringify(info.root)});`
    );
    if (hostApp !== info.app) throw new Error(`Host scripts failed to load (got "${hostApp}").`);
    return info;
  }

  // Long jobs (drawing many artboards, layouts, exports) get more time than quick lookups.
  const SLOW = { draw: 180000, layout: 180000, exportTiles: 600000, split: 120000, arrange: 120000, check: 60000, snap: 60000 };

  async function call(name, arg = {}) {
    // Once the host has stopped answering, fail at once instead of queueing more calls behind it.
    if (stalled && name !== 'ping') throw new Error(stalledMessage());
    const raw = await evalRaw(`PortableGrid.call(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(arg))})`, SLOW[name] || 15000);
    let res;
    try {
      res = JSON.parse(raw);
    } catch {
      throw new Error(`Unexpected reply from ${info.app}: ${raw}`);
    }
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }

  function chooseFile(title, extensions) {
    const r = window.cep.fs.showOpenDialogEx(false, false, title, '', extensions);
    return r.err === 0 && r.data && r.data.length ? r.data[0] : null;
  }

  function revealFolder(dir) {
    const { spawn } = node('child_process');
    const cmd = process.platform === 'win32' ? 'explorer' : 'open';
    spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref();
  }

  function chooseFolder(title) {
    const r = window.cep.fs.showOpenDialogEx(false, true, title, '', []);
    return r.err === 0 && r.data && r.data.length ? r.data[0] : null;
  }

  return { info, init, call, chooseFile, chooseFolder, revealFolder, node, onStall, isStalled };
})();
