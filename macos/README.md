# Basira — macOS app

Native SwiftUI shell around the Basira web UI, plus a **Today** desktop widget.

## What it is
- **Basira.app** — a windowed macOS app that loads the local backend
  (`http://localhost:8001`, served by the `com.sysgo.backend` launchd service)
  in a `WKWebView`. Full existing UI, own Dock icon and window. ⌘R reloads.
- **Today widget** — WidgetKit extension (small / medium / large) showing today's
  focus + daily tasks with a done/total bar. Tapping a task's circle completes it
  via `POST /tasks/{id}/complete` and refreshes. Reads `/today` directly over HTTP.

## Requirements
- Xcode + `xcodegen` (`brew install xcodegen`)
- The backend running (the launchd service, or `uvicorn app.main:app --port 8001`)
- No Apple developer account — builds with local ad-hoc signing.

## Build / install
```bash
./build.sh
open -a Basira
```
Then add the widget: right-click the desktop → **Edit Widgets** → search **Basira**
(or Notification Center → **Edit Widgets**).

## Notes
- The widget refreshes on the system's schedule (~15 min); tapping to complete
  refreshes immediately. Changes made in the web UI appear on the next refresh.
- If the backend is down, both the app and the widget show an offline state.
- `Backend.baseURL` (app) and `WidgetBackend.baseURL` (widget) hold the port.
