#!/bin/sh
# Makes Illustrator/Photoshop load PortableGrid straight from this folder (macOS, development only).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
echo "Enabled unsigned extensions (PlayerDebugMode=1)."

EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
mkdir -p "$EXT_DIR"
if [ -e "$EXT_DIR/PortableGrid" ]; then
  echo "Already installed at $EXT_DIR/PortableGrid"
else
  ln -s "$ROOT" "$EXT_DIR/PortableGrid"
  echo "Linked $EXT_DIR/PortableGrid -> $ROOT"
fi
echo "Restart Illustrator/Photoshop, then open Window > Extensions > PortableGrid."
