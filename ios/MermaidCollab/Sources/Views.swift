import SwiftUI

struct ContentView: View {
    @EnvironmentObject var store: ZenStore
    // Re-tick so the freshness wash + recency ordering refresh each second.
    @State private var now = Date().timeIntervalSince1970 * 1000
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private let columns = [GridItem(.adaptive(minimum: 300, maximum: 520), spacing: 12)]

    var body: some View {
        NavigationStack {
            Group {
                if store.ordered.isEmpty {
                    ContentUnavailableCompat(connected: store.connected)
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(store.ordered) { s in
                                ZenCardView(summary: s, now: now)
                            }
                        }
                        .padding(12)
                    }
                }
            }
            .navigationTitle("Zen")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Circle()
                        .fill(store.connected ? Color.green : Color.gray)
                        .frame(width: 9, height: 9)
                }
            }
        }
        .onReceive(tick) { _ in now = Date().timeIntervalSince1970 * 1000 }
    }
}

private struct ContentUnavailableCompat: View {
    let connected: Bool
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: connected ? "moon.zzz" : "wifi.slash")
                .font(.largeTitle).foregroundStyle(.secondary)
            Text(connected ? "No watched sessions yet" : "Connecting to the sidecar…")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ZenCardView: View {
    let summary: ZenSummary
    let now: Double
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Project bar
            HStack {
                Text(summary.projectName.uppercased())
                    .font(.caption2).fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                Text("Open ↗").font(.caption2).foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(Color.primary.opacity(0.04))

            Divider()

            // Body — status + glance/detail
            VStack(spacing: 8) {
                HStack(spacing: 6) {
                    Circle().fill(summary.statusColor).frame(width: 7, height: 7)
                    Text(summary.sessionName.uppercased())
                        .font(.caption2).foregroundStyle(.secondary)
                }
                if summary.paragraph.isEmpty {
                    Text("No summary yet · \(summary.statusLabel)")
                        .font(.callout).italic().foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity)
                } else {
                    Text(expanded ? summary.expanded : summary.glance)
                        .font(.title3).fontWeight(.medium)
                        .lineSpacing(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if summary.hasMore {
                        Text(expanded ? "less" : "more")
                            .font(.caption2).fontWeight(.semibold)
                            .foregroundStyle(.tint)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .onTapGesture { if summary.hasMore { withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() } } }
        }
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(.secondarySystemGroupedBackground))
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.blue.opacity(summary.freshnessOpacity(now: now)))
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(summary.hasQuestion ? Color.orange.opacity(0.6) : Color.primary.opacity(0.08),
                              lineWidth: summary.hasQuestion ? 1.5 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
