#!/bin/sh
# Double-click to install PortableGrid for Illustrator / Photoshop on macOS (current user).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/PortableGrid"
EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
TARGET="$EXT_DIR/PortableGrid"

if [ ! -d "$SRC" ]; then
  echo "The PortableGrid folder was not found next to this installer."
  exit 1
fi

echo "Installing PortableGrid..."
mkdir -p "$EXT_DIR"
if [ -L "$TARGET" ]; then
  echo "A development copy of PortableGrid is linked at $TARGET. Remove that link first."
  exit 1
fi
rm -rf "$TARGET"
cp -R "$SRC" "$TARGET"
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true

# Unsigned extensions need debug mode on (CEP 9-12).
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo ""
echo "Installed to $TARGET"
echo "Restart Illustrator or Photoshop, then open Window > Extensions > PortableGrid"
echo "(Photoshop: Window > Extensions (Legacy) > PortableGrid)."
