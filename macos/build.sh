#!/usr/bin/env bash
# Build the Basira macOS host app + Today widget, and install it to /Applications.
#
#   ./build.sh                only build (to macos/build/), do not install
#   ./build.sh --install      build, then replace /Applications/Basira.app
#
# Signs locally (ad-hoc) — no Apple developer account needed.
set -euo pipefail
cd "$(dirname "$0")"

INSTALL=0
[[ "${1:-}" == "--install" ]] && INSTALL=1
[[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

die() { printf '\n\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── Prerequisites ────────────────────────────────────────────────────────────
[[ "$(uname -s)" == "Darwin" ]] || die "the macOS app can only be built on macOS."
command -v xcodebuild >/dev/null || die "xcodebuild not found. Install Xcode from the App Store."
xcodebuild -version >/dev/null 2>&1 || die "xcodebuild is pointed at the Command Line Tools, not Xcode.
  Install Xcode, then:  sudo xcode-select -s /Applications/Xcode.app"
command -v xcodegen >/dev/null || die "xcodegen not found. Install it with:  brew install xcodegen"

echo "→ generating Xcode project"
xcodegen generate

echo "→ building (Release, local signing)"
xcodebuild -project Basira.xcodeproj -scheme Basira -configuration Release \
  -derivedDataPath build \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES \
  build

APP="build/Build/Products/Release/Basira.app"
[[ -d "$APP" ]] || die "the build finished but $APP is missing."

if [[ "$INSTALL" -eq 0 ]]; then
  echo "✓ built $PWD/$APP"
  echo "  Install it with:  $0 --install"
  exit 0
fi

echo "→ installing to /Applications"
rm -rf /Applications/Basira.app
cp -R "$APP" /Applications/
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f /Applications/Basira.app

echo "✓ done. Open with:  open -a Basira"
echo "  Add the widget:  right-click desktop → Edit Widgets → search 'Basira'"
