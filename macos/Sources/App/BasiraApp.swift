import SwiftUI

@main
struct BasiraApp: App {
    @StateObject private var web = WebViewModel(url: Backend.baseURL)

    var body: some Scene {
        WindowGroup {
            RootView(web: web)
                .frame(minWidth: 900, minHeight: 640)
        }
        .defaultSize(width: 1240, height: 840)
        .commands {
            CommandGroup(after: .toolbar) {
                Button("Reload") { web.reload() }
                    .keyboardShortcut("r", modifiers: .command)
            }
        }
    }
}
