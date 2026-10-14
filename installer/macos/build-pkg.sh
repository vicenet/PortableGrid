#!/bin/sh
# Builds dist/PortableGrid-<version>.pkg on macOS from the staged extension folder.
#   node scripts/package.js && sh installer/macos/build-pkg.sh
# Installs to /Library/Application Support/Adobe/CEP/extensions/PortableGrid (all users).
set -e
cd "$(dirname "$0")/../.."
VERSION="$(node -p "require('./package.json').version")"
STAGE="dist/PortableGrid-$VERSION"
[ -d "$STAGE" ] || { echo "Missing $STAGE - run node scripts/package.js first"; exit 1; }

WORK="$(mktemp -d)"
DEST="$WORK/root/Library/Application Support/Adobe/CEP/extensions/PortableGrid"
mkdir -p "$DEST"
cp -R "$STAGE/." "$DEST/"
find "$WORK/root" -name .DS_Store -delete
chmod -R u+rwX,go+rX "$WORK/root"
chmod +x installer/macos/scripts/postinstall

pkgbuild \
  --root "$WORK/root" \
  --identifier com.portablegrid.extension \
  --version "$VERSION" \
  --install-location / \
  --scripts installer/macos/scripts \
  "$WORK/component.pkg"

# Wrap it in a product archive with a welcome text and the licence.
mkdir -p "$WORK/resources"
cp LICENSE "$WORK/resources/LICENSE.txt"
cat > "$WORK/resources/welcome.txt" <<EOF
PortableGrid $VERSION

A free, open-source layout grid plugin for Adobe Illustrator and Photoshop.

After installing, restart Illustrator or Photoshop and open
Window > Extensions > PortableGrid
(Photoshop: Window > Extensions (Legacy) > PortableGrid).
EOF
cat > "$WORK/distribution.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>PortableGrid $VERSION</title>
  <welcome file="welcome.txt"/>
  <license file="LICENSE.txt"/>
  <options customize="never" require-scripts="false" hostArchitectures="x86_64,arm64"/>
  <domains enable_localSystem="true"/>
  <choices-outline><line choice="default"/></choices-outline>
  <choice id="default" title="PortableGrid"><pkg-ref id="com.portablegrid.extension"/></choice>
  <pkg-ref id="com.portablegrid.extension" version="$VERSION">component.pkg</pkg-ref>
</installer-gui-script>
EOF
productbuild \
  --distribution "$WORK/distribution.xml" \
  --resources "$WORK/resources" \
  --package-path "$WORK" \
  "dist/PortableGrid-$VERSION.pkg"

rm -rf "$WORK"
echo "Built dist/PortableGrid-$VERSION.pkg"
