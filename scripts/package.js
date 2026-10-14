#!/usr/bin/env node
// Builds PortableGrid release files into dist/:
//
//   PortableGrid-<v>.zxp            signed extension (Windows-signed; install with any ZXP installer)
//   PortableGrid-<v>-windows.zip    .zxp + double-click installer
//   PortableGrid-<v>-macos.zip      extension folder + double-click installer
//
//   npm run package
//
// Signing needs Adobe's ZXPSignCmd and a .p12 certificate. They are looked up (in this order) from
//   ZXP_SIGN_CMD / ZXP_CERT / ZXP_PASSWORD environment variables, or
//   a signing folder (ZXP_SIGNING_DIR, default ../PortableGrid-signing or ../PortableStudio-signing) containing
//   ZXPSignCmd(.exe), one *.p12 file and certificate-password.txt.
// Keep that folder out of the repository. Create a certificate once with:
//   ZXPSignCmd -selfSignedCert <country> <state> <org> <name> <password> cert.p12 -validityDays 3650
// Without signing tools only the unsigned macOS bundle is built.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createZip } = require('./lib/zip');

const ROOT = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const OUT = path.join(ROOT, 'dist');
const NAME = `PortableGrid-${pkg.version}`;
const STAGE = path.join(OUT, NAME);
const INSTALL = path.join(ROOT, 'scripts', 'install');

// What ships. Tests, dev scripts and the .debug file stay out.
const INCLUDE = ['CSXS', 'icons', 'index.html', 'css', 'js', 'host', 'core', 'config', 'LICENSE', 'README.md', 'package.json'];
const JUNK = new Set(['.DS_Store', 'Thumbs.db', '__MACOSX']);

// Copies files, never symlinks (Adobe's signing breaks on symlinks).
function copy(src, dest) {
  if (JUNK.has(path.basename(src))) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) copy(path.join(src, f), path.join(dest, f));
  } else {
    fs.copyFileSync(src, dest);
  }
}

function walk(dir, base = dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const mb = (p) => (fs.statSync(p).size / 1048576).toFixed(1);
const rel = (p) => path.relative(ROOT, p);
const crlf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r?\n/g, '\r\n'));
const lf = (buf) => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'));
const readInstall = (f) => fs.readFileSync(path.join(INSTALL, f));

function signingConfig() {
  const { ZXP_SIGN_CMD, ZXP_CERT, ZXP_PASSWORD } = process.env;
  if (ZXP_SIGN_CMD && ZXP_CERT && ZXP_PASSWORD) return { cmd: ZXP_SIGN_CMD, cert: ZXP_CERT, password: ZXP_PASSWORD };
  // One certificate signs all the Portable apps: ../PortableGrid-signing, else ../PortableStudio-signing.
  const dir = path.resolve(process.env.ZXP_SIGNING_DIR || ['PortableGrid-signing', 'PortableStudio-signing'].map((d) => path.join(ROOT, '..', d)).find((d) => fs.existsSync(d)) || path.join(ROOT, '..', 'PortableGrid-signing'));
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const cmd = files.find((f) => /^ZXPSignCmd(\.exe)?$/i.test(f));
  const cert = files.find((f) => f.toLowerCase().endsWith('.p12'));
  const pwFile = path.join(dir, 'certificate-password.txt');
  if (!cmd || !cert || !fs.existsSync(pwFile)) return null;
  return { cmd: path.join(dir, cmd), cert: path.join(dir, cert), password: fs.readFileSync(pwFile, 'utf8').trim() };
}

// ---- stage ----
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const item of INCLUDE) {
  const src = path.join(ROOT, item);
  if (fs.existsSync(src)) copy(src, path.join(STAGE, item));
}
const files = walk(STAGE);
console.log(`Staged ${files.length} files in ${rel(STAGE)}`);

// ---- macOS bundle (unsigned folder + installer; signing on Windows doesn't carry over to macOS) ----
const macZip = path.join(OUT, `${NAME}-macos.zip`);
fs.writeFileSync(macZip, createZip([
  ...files.map((f) => ({ name: `${NAME}-macos/PortableGrid/${f}`, data: fs.readFileSync(path.join(STAGE, f)) })),
  { name: `${NAME}-macos/Install PortableGrid.command`, data: lf(readInstall('Install PortableGrid.command')), mode: 0o755 },
  { name: `${NAME}-macos/INSTALL.txt`, data: lf(readInstall('INSTALL.txt')) },
]));
console.log(`macOS:   ${rel(macZip)} (${mb(macZip)} MB)`);

// ---- signed .zxp + Windows bundle ----
const signing = signingConfig();
if (!signing) {
  console.log('Not signed: no signing tools found (see the top of scripts/package.js). Skipped .zxp and Windows bundle.');
  process.exit(0);
}
const zxp = path.join(OUT, `${NAME}.zxp`);
fs.rmSync(zxp, { force: true });
// No timestamp by default: ZXPSignCmd 4.1.103 crashes with -tsa. Set ZXP_TSA=<url> to add one with a fixed build.
const signArgs = ['-sign', STAGE, zxp, signing.cert, signing.password];
if (process.env.ZXP_TSA) signArgs.push('-tsa', process.env.ZXP_TSA);
const sign = spawnSync(signing.cmd, signArgs, { encoding: 'utf8' });
if (sign.status !== 0 || !fs.existsSync(zxp)) {
  console.error(sign.stdout, sign.stderr);
  throw new Error('Signing failed.');
}
const verify = spawnSync(signing.cmd, ['-verify', zxp], { encoding: 'utf8' });
console.log(`Signed:  ${rel(zxp)} (${mb(zxp)} MB) - ${(verify.stdout || verify.stderr).trim()}`);

const winZip = path.join(OUT, `${NAME}-windows.zip`);
fs.writeFileSync(winZip, createZip([
  { name: `${NAME}-windows/PortableGrid.zxp`, data: fs.readFileSync(zxp) },
  { name: `${NAME}-windows/Install PortableGrid.bat`, data: crlf(readInstall('Install PortableGrid.bat')) },
  { name: `${NAME}-windows/install-windows.ps1`, data: crlf(readInstall('install-windows.ps1')) },
  { name: `${NAME}-windows/INSTALL.txt`, data: crlf(readInstall('INSTALL.txt')) },
]));
console.log(`Windows: ${rel(winZip)} (${mb(winZip)} MB)`);
