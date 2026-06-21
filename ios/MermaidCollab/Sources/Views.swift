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
                    EmptyState(connected: store.connected)
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(store.ordered) { s in
                                ZenCardView(summary: s, escalation: store.openEscalation(for: s), now: now)
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

private struct EmptyState: View {
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
    let escalation: Escalation?
    let now: Double
    @EnvironmentObject var store: ZenStore
    @State private var expanded = false

    private var escOptions: [EscOption] { escalation?.options ?? [] }
    private var paneOptions: [ZenOption] { summary.structured?.options ?? [] }
    private var questionText: String? { escalation?.questionText ?? summary.structured?.question }
    private var showQuestion: Bool { !escOptions.isEmpty || !paneOptions.isEmpty }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Project bar
            HStack {
                Text(summary.projectName.uppercased())
                    .font(.caption2).fontWeight(.semibold)
                    .foregroundStyle(.secondary).lineLimit(1)
                Spacer()
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
                        .font(.title3).fontWeight(.medium).lineSpacing(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if summary.hasMore {
                        Text(expanded ? "less" : "more")
                            .font(.caption2).fontWeight(.semibold).foregroundStyle(.tint)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(16).frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .onTapGesture { if summary.hasMore { withAnimation(.easeInOut(duration: 0.15)) { expanded.toggle() } } }

            // Question + answers (only when the session is asking)
            if showQuestion {
                Divider()
                VStack(spacing: 10) {
                    if let q = questionText {
                        Text(q).font(.subheadline).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    answerButtons
                }
                .padding(16)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(.secondarySystemGroupedBackground))
                .overlay(RoundedRectangle(cornerRadius: 16).fill(Color.blue.opacity(summary.freshnessOpacity(now: now))))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(showQuestion ? Color.orange.opacity(0.6) : Color.primary.opacity(0.08),
                              lineWidth: showQuestion ? 1.5 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    @ViewBuilder private var answerButtons: some View {
        // Wrapping flow of pill buttons.
        FlowLayout(spacing: 8) {
            if !escOptions.isEmpty {
                ForEach(escOptions) { opt in
                    answerPill(opt.label, recommended: escalation?.recommended == opt.id) {
                        if let id = escalation?.id { store.decide(id, optionId: opt.id) }
                    }
                }
            } else {
                ForEach(Array(paneOptions.enumerated()), id: \.offset) { i, opt in
                    answerPill(opt.label, recommended: i == summary.structured?.recommended) {
                        store.answer(project: summary.project, session: summary.session, text: opt.valueToSend)
                    }
                }
            }
        }
    }

    private func answerPill(_ label: String, recommended: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(label).font(.subheadline)
                if recommended { Text("★").font(.caption2) }
            }
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(
                Capsule().fill(recommended ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.06))
            )
            .overlay(Capsule().strokeBorder(recommended ? Color.accentColor.opacity(0.5) : Color.primary.opacity(0.12)))
        }
        .buttonStyle(.plain)
        .foregroundStyle(recommended ? Color.accentColor : Color.primary)
    }
}

/// Minimal wrapping HStack (chips wrap to the next line) — SwiftUI has no built-in until iOS 16's
/// Layout protocol, which we use here (deployment target is 16).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxW, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
        return CGSize(width: maxW == .infinity ? x : maxW, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let maxW = bounds.width
        var x: CGFloat = bounds.minX, y: CGFloat = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x - bounds.minX + s.width > maxW, x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
    }
}
