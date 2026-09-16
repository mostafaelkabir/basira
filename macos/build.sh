#!/usr/bin/env bash
# Build the Basira macOS host app + Today widget and install it to /Applications.
# Requires: Xcode, xcodegen (brew install xcodegen). Local ad-hoc signing (no Apple account needed).
set -euo pipefail
cd "$(dirname "$0")"

echo "→ generating Xcode project"
xcodegen generate

echo "→ building (Release, local signing)"
xcodebuild -project Basira.xcodeproj -scheme Basira -configuration Release \
  -derivedDataPath build \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES \
  build

APP="build/Build/Products/Release/Basira.app"
echo "→ installing to /Applications"
rm -rf /Applications/Basira.app
cp -R "$APP" /Applications/
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/Basira.app

echo "✓ done. Open with:  open -a Basira"
echo "  Add the widget:  right-click desktop → Edit Widgets → search 'Basira'"
