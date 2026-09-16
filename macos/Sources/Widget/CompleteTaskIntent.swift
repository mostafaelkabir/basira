import AppIntents
import WidgetKit

/// Tapping a row on the widget completes that task, then refreshes the timeline.
struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Task"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Task ID")
    var taskID: String

    init() {}
    init(taskID: String) { self.taskID = taskID }

    func perform() async throws -> some IntentResult {
        await BasiraAPI.completeTask(taskID)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
