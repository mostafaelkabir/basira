# Basira — macOS app

Native SwiftUI shell around the Basira web UI, plus a **Today** desktop widget.

## What it is
- **Basira.app** — a windowed macOS app that loads the local backend
  (`http://localhost:8001`, served by the `com.basira.backend` launchd service)
  in a `WKWebView`. Full existing UI, own Dock icon and window. ⌘R reloads.
- **Today widget** — WidgetKit extension (small / medium / large) showing today's
  focus + daily tasks with a done/total bar. Tapping a task's circle completes it
  via `POST /tasks/{id}/complete` and refreshes. Reads `/today` directly over HTTP.

## Requirements
- Xcode (the full app, not just the Command Line Tools)
- `xcodegen` — `brew install xcodegen`
- The backend running — `../install.sh` sets it up as a login service
- No Apple developer account: it builds with local ad-hoc signing.

## Build / install
```bash
./build.sh              # build only, into macos/build/
./build.sh --install    # build and replace /Applications/Basira.app
open -a Basira
```

Or in one step from the project root: `./install.sh --app`.

Then add the widget: right-click the desktop → **Edit Widgets** → search **Basira**
(or Notification Center → **Edit Widgets**).

## Notes
- The widget refreshes on the system's schedule (~15 min); tapping to complete
  refreshes immediately. Changes made in the web UI appear on the next refresh.
- If the backend is down, both the app and the widget show an offline state.
  Restart it with `launchctl kickstart -k gui/$UID/com.basira.backend`.
- Running the backend on a non-default port? The app and the widget are separate
  processes with separate preference domains, so set both:
  ```bash
  defaults write com.sysgo.Basira        BasiraPort -int 8002
  defaults write com.sysgo.Basira.Widget BasiraPort -int 8002
  ```
