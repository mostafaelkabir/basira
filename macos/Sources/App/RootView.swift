import SwiftUI
import WebKit

struct RootView: View {
    @ObservedObject var web: WebViewModel

    var body: some View {
        ZStack {
            WebContainer(webView: web.webView)
                .ignoresSafeArea()
            if web.failed {
                OfflineView { web.reload() }
            }
        }
    }
}

/// Bridges the AppKit WKWebView into SwiftUI.
struct WebContainer: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

/// Shown when the launchd backend service is not answering.
struct OfflineView: View {
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "bolt.horizontal.circle")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.secondary)
            Text("Basira backend is not running")
                .font(.headline)
            Text("Start the service, then retry.\nlaunchctl kickstart -k gui/$UID/com.basira.backend")
                .font(.system(.caption, design: .monospaced))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Retry", action: retry)
                .keyboardShortcut(.defaultAction)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.background)
    }
}
