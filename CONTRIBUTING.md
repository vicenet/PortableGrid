# Contributing to PortableGrid

Thanks for helping! Bug reports, presets and pull requests are all welcome.

## Setup

1. Install Node.js 18+ and Adobe Illustrator and/or Photoshop (2021 or later).
2. Run `scripts/dev-install.ps1` (Windows) or `sh scripts/dev-install.sh` (macOS). It links this folder into
   Adobe's extensions folder and allows unsigned extensions.
3. Restart Illustrator/Photoshop and open **Window › Extensions › PortableGrid**.

## Where things are

- `core/grid.js`: all grid maths (no Adobe APIs). Add tests in `tests/grid.test.js` for any change.
- `host/*.jsx`: ExtendScript (ES3: no `let`, arrow functions, `forEach` or JSON). `tests/syntax.test.js` checks this.
- `js/panel.js`, `js/render.js`: panel UI and the live preview.
- `config/presets.json`: built-in presets. Every preset needs a `name` and a `group`.

## Pull requests

- Run `npm test` before opening a PR. CI runs the tests, CodeQL and a dependency review.
- Keep changes focused, and describe how you tested them in Illustrator and/or Photoshop.
- By contributing you agree that your work is licensed under GPL-3.0.
