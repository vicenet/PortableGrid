<p align="center">
  <img src=".github/assets/banner.png" alt="PortableGrid: free layout grid plugin for Adobe Illustrator and Photoshop" width="100%">
</p>

<h1 align="center">PortableGrid: Layout Grid Generator for Adobe Illustrator &amp; Photoshop</h1>

<p align="center">
  <b>Free, open-source grid plugin for designers: column grids, modular grids, baseline grids, golden ratio
  and composition guides, isometric and dot grids, in one click.</b>
</p>

<p align="center">
  <a href="https://github.com/vicenet/PortableGrid/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/vicenet/PortableGrid?label=download&color=00A3FF"></a>
  <a href="https://github.com/vicenet/PortableGrid/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/vicenet/PortableGrid/total?color=1F3A5F"></a>
  <a href="LICENSE"><img alt="License: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-1F3A5F"></a>
  <img alt="Adobe Illustrator 2021+" src="https://img.shields.io/badge/Illustrator-2021%2B-FF9A00">
  <img alt="Adobe Photoshop 2021+" src="https://img.shields.io/badge/Photoshop-2021%2B-31A8FF">
  <img alt="Windows and macOS" src="https://img.shields.io/badge/Windows%20%7C%20macOS-supported-3E5C76">
  <a href="https://github.com/vicenet/PortableGrid/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/vicenet/PortableGrid/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/vicenet/PortableGrid"><img alt="OpenSSF Scorecard" src="https://api.scorecard.dev/projects/github.com/vicenet/PortableGrid/badge"></a>
</p>

<p align="center">
  <a href="https://github.com/vicenet/PortableGrid/releases/latest"><b>Download</b></a> ·
  <a href="#grid-types">Grid types</a> ·
  <a href="#features">Features</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="https://github.com/vicenet/PortableStudio">PortableStudio (brand guidelines)</a>
</p>

---

**PortableGrid** is a free **Adobe Illustrator grid plugin** and **Photoshop guides extension**. Set up
columns, rows, gutters and margins (or pick one of 26 presets), see a live preview, and draw the grid as
guides, cells, lines or artboards on the artboard, every artboard, or your selection.

It's a free, open-source alternative to paid guide and grid plugins: no subscription, no account, and it
works in both Illustrator and Photoshop.

## Download

| Platform | File | Install |
|---|---|---|
| **Windows 10/11** | [`PortableGrid-setup.exe`](https://github.com/vicenet/PortableGrid/releases/latest) | Run the installer (no admin rights needed) |
| **macOS** (Intel & Apple silicon) | [`PortableGrid.pkg`](https://github.com/vicenet/PortableGrid/releases/latest) | Open the package and follow the steps |
| **Any ZXP installer** | [`PortableGrid.zxp`](https://github.com/vicenet/PortableGrid/releases/latest) | Signed Adobe extension |

Then restart Illustrator/Photoshop and open **Window › Extensions › PortableGrid**
(Photoshop: **Window › Extensions (Legacy)**). Requires Illustrator 2021+ and/or Photoshop 2021+.

## Grid types

<p align="center">
  <img src=".github/assets/grid-types.png" width="100%" alt="Column grid, modular grid, baseline grid, hierarchical grid, Van de Graaf canon, rule of thirds, golden spiral, phi grid, harmonic armature, golden triangles, isometric grid, hexagon grid, dot grid, triangle grid, square grid and Instagram grid made with PortableGrid">
</p>

| Layout grids | Composition guides | Drawing grids |
|---|---|---|
| **Column grid**: any number of columns, gutters and margins | **Rule of thirds** | **Square grid** (graph paper, 8pt grid) |
| **Modular grid**: columns × rows of cells | **Phi grid** (golden sections) | **Dot grid** |
| **Baseline grid** for type, with offset | **Golden spiral** (flip to any corner) | **Isometric grid** (30°) |
| **Hierarchical grid**: uneven tracks like `2fr 1fr` or `240px auto` | **Golden triangles** | **Triangle grid** (60°) |
| **Manuscript grid** and the **Van de Graaf canon** | **Harmonic armature** and **diagonals** | **Hexagon grid** |
| **Fixed-width web containers** (Bootstrap 1320 px, 12 / 8 / 4 columns) | **Centre cross** | |
| **Facing pages**: margins mirror on every second artboard | | |

## Features

- **Live preview** of the grid on your artboard, canvas or selection, updated as you type.
- **Any unit in any field**: `20`, `20px`, `5mm`, `12pt`, `0.5in` or `10%`.
- **Draw it your way**: guides, coloured cells, styled lines (colour, weight, opacity) or, in Illustrator,
  everything as guides. Grids go on their own layer and can be cleared or replaced in one click.
- **Where you need it**: the active artboard, all artboards, the selection, or each selected object.
- **Artboard per cell** (Illustrator): turn a grid into artboards for carousels, social posts or contact sheets.
- **Arrange into cells** (Illustrator): drop selected images or objects into the grid, fit, fill and crop, or stretch.
- **Split into tiles** (Illustrator): cut artwork into clipped tiles, with gutters as gaps.
- **Export tiles** as numbered PNG/JPEG files: perfect for **Instagram 3 × 3 profile grids** and **seamless carousels**.
- **26 presets** for web, print, editorial, composition, drawing and social layouts, plus your own saved presets.

## How it works

1. **Pick a preset** or set margins, columns, rows, a baseline, a drawing grid or composition guides.
2. **Choose where to draw**: active artboard, all artboards, selection or each selected object.
3. **Draw grid.** Change anything and draw again: the previous grid is replaced. **Clear** removes it.

## For developers

```bash
git clone https://github.com/vicenet/PortableGrid.git
cd PortableGrid
powershell -ExecutionPolicy Bypass -File scripts\dev-install.ps1   # Windows
sh scripts/dev-install.sh                                           # macOS
npm test
npm run package                                                     # release builds in dist/
```

Plain JavaScript (Adobe CEP panel) and ExtendScript, with no dependencies. The grid maths lives in
[`core/grid.js`](core/grid.js) and is fully tested. Releases are built by GitHub Actions: pushing a `v*` tag
builds the Windows `.exe` and macOS `.pkg`.

```
index.html, css/, js/   Panel UI and live preview
core/grid.js            Layout engine: tracks, baselines, drawing grids, composition guides
host/                   ExtendScript for Illustrator / Photoshop
config/presets.json     Built-in presets
installer/              Windows (Inno Setup) and macOS (pkgbuild) installers
```

## FAQ

**Is PortableGrid free?** Yes. It's free and open source under GPL-3.0, for personal and commercial work.

**How is it different from Illustrator's "Split into Grid" or Photoshop's "New Guide Layout"?** Those make
simple equal grids. PortableGrid adds baseline grids, uneven (hierarchical) columns, golden ratio and
composition guides, isometric, hexagon and dot grids, facing pages, presets, a live preview, and works the
same in both apps.

**Can I use it for Instagram grids and carousels?** Yes. Use the Instagram presets, then *Export tiles* to
save each square or slide as a numbered image ready to post.

**Does it change my artwork?** Drawing a grid only adds a `PortableGrid` layer (Illustrator) or guides and
`PortableGrid` layers (Photoshop). *Arrange* and *Split* change the selected artwork, and can be undone.

**Why does Windows/macOS warn when installing?** The installers aren't signed with paid developer
certificates yet. They're built by GitHub Actions from this public source code.

## Licence

[GPL-3.0](LICENSE). Found a security problem? See [SECURITY.md](SECURITY.md). PortableGrid is an independent
project, not affiliated with Adobe. Illustrator and Photoshop are trademarks of Adobe Inc.

Also by the same author: [**PortableStudio**](https://github.com/vicenet/PortableStudio), a free brand
guidelines generator for Illustrator and Photoshop.

⭐ **If PortableGrid saves you time, star the repo.** It helps other designers find it.
