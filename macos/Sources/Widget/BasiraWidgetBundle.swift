import WidgetKit
import SwiftUI

@main
struct BasiraWidgetBundle: WidgetBundle {
    var body: some Widget { TodayWidget() }
}

struct TodayWidget: Widget {
    let kind = "BasiraTodayWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Your focus tasks and today's to-dos. Tap to complete.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
