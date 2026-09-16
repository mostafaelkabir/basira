import Foundation

/// Shared backend location. The launchd service (com.sysgo.backend) serves the
/// built SPA and the JSON API on this port.
enum Backend {
    static let baseURL = URL(string: "http://localhost:8001")!
}
