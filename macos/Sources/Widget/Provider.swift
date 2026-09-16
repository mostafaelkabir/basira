import WidgetKit

struct TodayEntry: TimelineEntry {
    let date: Date
    let items: [TaskItem]
    let doneCount: Int
    let totalCount: Int
    let reachable: Bool

    static let placeholder = TodayEntry(
        date: Date(),
        items: [
            TaskItem(id: "1", title: "Apply for 5 jobs", status: "todo", goal_title: "Daily"),
            TaskItem(id: "2", title: "Deep work block", status: "todo", goal_title: "Focus"),
            TaskItem(id: "3", title: "Workout", status: "done", goal_title: "Health"),
        ],
        doneCount: 1, totalCount: 3, reachable: true
    )
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        if context.isPreview {
            completion(.placeholder); return
        }
        Task { completion(await makeEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        Task {
            let entry = await makeEntry()
            // Refresh ~every 15 min; interactive taps reload immediately.
            let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func makeEntry() async -> TodayEntry {
        guard let today = await BasiraAPI.fetchToday() else {
            return TodayEntry(date: Date(), items: [], doneCount: 0, totalCount: 0, reachable: false)
        }
        // Focus first, then daily; de-duplicate by id.
        var seen = Set<String>()
        var merged: [TaskItem] = []
        for t in today.focus + today.daily where !seen.contains(t.id) {
            seen.insert(t.id)
            merged.append(t)
        }
        let done = merged.filter { $0.isDone }.count
        // Show open tasks first, then completed.
        let ordered = merged.sorted { a, b in a.isDone == b.isDone ? false : !a.isDone }
        return TodayEntry(
            date: Date(),
            items: ordered,
            doneCount: done,
            totalCount: merged.count,
            reachable: true
        )
    }
}
