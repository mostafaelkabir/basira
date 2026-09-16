import Foundation

enum WidgetBackend {
    static let baseURL = URL(string: "http://localhost:8001")!
}

/// Minimal subset of a task as returned by /today (focus and daily arrays).
struct TaskItem: Codable, Identifiable {
    let id: String
    let title: String
    let status: String
    let goal_title: String?

    var isDone: Bool { status == "done" }
}

/// Minimal subset of the /today response.
struct TodayResponse: Codable {
    let date: String
    let focus: [TaskItem]
    let daily: [TaskItem]
}

enum BasiraAPI {
    /// Fetch today's focus + daily tasks. Returns nil when the backend is unreachable.
    static func fetchToday() async -> TodayResponse? {
        var req = URLRequest(url: WidgetBackend.baseURL.appendingPathComponent("today"))
        req.timeoutInterval = 6
        req.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            return try JSONDecoder().decode(TodayResponse.self, from: data)
        } catch {
            return nil
        }
    }

    /// Mark a task done via POST /tasks/{id}/complete.
    static func completeTask(_ id: String) async {
        let url = WidgetBackend.baseURL
            .appendingPathComponent("tasks")
            .appendingPathComponent(id)
            .appendingPathComponent("complete")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = Data("{}".utf8)
        req.timeoutInterval = 6
        _ = try? await URLSession.shared.data(for: req)
    }
}
