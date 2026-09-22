import Foundation

/// Shared backend location. The launchd service (com.basira.backend) serves the
/// built SPA and the JSON API on this port.
///
/// Installed on a non-default port? Point the app at it with:
///   defaults write com.sysgo.Basira BasiraPort -int 8002
enum Backend {
    static let port: Int = {
        let stored = UserDefaults.standard.integer(forKey: "BasiraPort")
        return stored > 0 ? stored : 8001
    }()

    static let baseURL = URL(string: "http://localhost:\(port)")!
}
