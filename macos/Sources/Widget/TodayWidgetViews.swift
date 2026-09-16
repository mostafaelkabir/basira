import SwiftUI
import WidgetKit

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: TodayEntry

    var body: some View {
        Group {
            if !entry.reachable {
                OfflineWidget()
            } else {
                switch family {
                case .systemSmall: SmallView(entry: entry)
                default:           ListView(entry: entry, rows: family == .systemLarge ? 8 : 4)
                }
            }
        }
        .containerBackground(for: .widget) {
            LinearGradient(colors: [Basira.canvas, Basira.raised],
                           startPoint: .top, endPoint: .bottom)
        }
    }
}

private struct Header: View {
    let entry: TodayEntry
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("TODAY")
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .tracking(2)
                .foregroundStyle(Basira.muted)
            Spacer()
            Text("\(entry.doneCount)/\(entry.totalCount)")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(Basira.accent)
        }
    }
}

private struct ProgressBar: View {
    let done: Int, total: Int
    var pct: Double { total == 0 ? 0 : Double(done) / Double(total) }
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.10))
                Capsule().fill(Basira.accent)
                    .frame(width: max(4, geo.size.width * pct))
                    .shadow(color: Basira.accent.opacity(0.6), radius: 4)
            }
        }
        .frame(height: 4)
    }
}

private struct SmallView: View {
    let entry: TodayEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Header(entry: entry)
            ProgressBar(done: entry.doneCount, total: entry.totalCount)
            VStack(alignment: .leading, spacing: 5) {
                ForEach(entry.items.prefix(3)) { item in
                    TaskRow(item: item, compact: true)
                }
                if entry.items.isEmpty {
                    Text("Nothing planned")
                        .font(.system(size: 12)).foregroundStyle(Basira.muted)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct ListView: View {
    let entry: TodayEntry
    let rows: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Header(entry: entry)
            ProgressBar(done: entry.doneCount, total: entry.totalCount)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(entry.items.prefix(rows)) { item in
                    TaskRow(item: item, compact: false)
                }
                if entry.items.isEmpty {
                    Text("Nothing planned for today")
                        .font(.system(size: 13)).foregroundStyle(Basira.muted)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct TaskRow: View {
    let item: TaskItem
    let compact: Bool
    var body: some View {
        HStack(spacing: 8) {
            if item.isDone {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Basira.accent)
                    .font(.system(size: compact ? 13 : 15))
            } else {
                Button(intent: CompleteTaskIntent(taskID: item.id)) {
                    Image(systemName: "circle")
                        .foregroundStyle(Basira.muted)
                        .font(.system(size: compact ? 13 : 15))
                }
                .buttonStyle(.plain)
            }
            Text(item.title)
                .font(.system(size: compact ? 12 : 13, weight: .medium))
                .foregroundStyle(item.isDone ? Basira.muted : Basira.ink)
                .strikethrough(item.isDone, color: Basira.muted)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }
}

private struct OfflineWidget: View {
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "bolt.horizontal.circle")
                .font(.system(size: 22)).foregroundStyle(Basira.muted)
            Text("Basira offline")
                .font(.system(size: 12, weight: .semibold)).foregroundStyle(Basira.ink)
            Text("Backend not running")
                .font(.system(size: 10)).foregroundStyle(Basira.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
