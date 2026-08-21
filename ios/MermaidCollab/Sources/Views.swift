import SwiftUI
import UIKit
import MermaidCollabCore

struct ContentView: View {
    @EnvironmentObject var store: ZenStore
    // Re-tick so the freshness wash + recency ordering refresh each second.
    @State private var now = Date().timeIntervalSince1970 * 1000
    @State private var drillInTarget: ZenSummary?
    @State private var showServers = false
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private let columns = [GridItem(.adaptive(minimum: 300, maximum: 520), spacing: Space.m)]

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: Space.m) {
                    // The only route to the fleet. Without a persistent entry point the
                    // picker is unreachable once connected, which is how the app shipped
                    // able to hold several servers but able to show exactly one.
                    Button { showServers = true } label: {
                        HStack(spacing: Space.xs) {
                            Image(systemName: "server.rack").font(.zenMeta)
                            Text(store.registry.entries.first { $0.id == store.selectedServerId }?.label ?? "Servers")
                                .font(.zenMeta)
                            Image(systemName: "chevron.down").font(.system(size: 9))
                        }
                        .foregroundStyle(.secondary)
                    }
                    .accessibilityIdentifier("server-picker-button")

                    if !store.connected {
                        HStack(spacing: Space.xs) {
                            Circle().fill(.secondary).frame(width: 7, height: 7)
                            Text("Connecting…").font(.zenMeta).foregroundStyle(.secondary)
                        }
                        .accessibilityLabel("Connecting to the sidecar")
                    }
                    if store.ordered.isEmpty {
                        EmptyState(connected: store.connected)
                    } else {
                        LazyVGrid(columns: columns, spacing: Space.m) {
                            ForEach(store.ordered) { s in
                                ZenCardView(summary: s, escalation: store.openEscalation(for: s), now: now, onDrillIn: { drillInTarget = $0 })
                            }
                        }
                    }
                }
                .padding(Space.m)
            }
        }
        .onReceive(tick) { _ in now = Date().timeIntervalSince1970 * 1000 }
        .sheet(isPresented: $showServers) {
            ServerPickerView()
        }
        .sheet(item: $drillInTarget) { s in
            MissionsListView(project: s.project, session: s.session)
                .environmentObject(store)
        }
    }
}

/// List of missions for a project, sourced from the bridge snapshot's `missionRows`. Each row
/// drills into `MissionDetailView`, which then fetches the per-mission diagnostic.
struct MissionsListView: View {
    let project: String
    let session: String
    @EnvironmentObject var store: ZenStore

    var body: some View {
        NavigationStack {
            List {
                ForEach(store.missionRows) { row in
                    NavigationLink {
                        MissionDetailView(project: project, session: session, missionId: row.id, row: row)
                    } label: {
                        MissionRowLabel(row: row)
                    }
                }
            }
            .navigationTitle("Missions")
        }
        .task {
            _ = await store.fetchBridgeSnapshot(project: project)
        }
    }
}

private struct MissionRowLabel: View {
    let row: MissionListRow

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(row.nickname ?? row.title)
                .font(.zenSessionName)

            if row.rollupConfirmed == false {
                HStack(spacing: Space.xs) {
                    Image(systemName: "exclamationmark.triangle")
                    Text("unconfirmed")
                }
                .font(.zenMeta)
                .foregroundStyle(.tertiary)

                Text(statusLine)
                    .font(.zenMeta)
                    .foregroundStyle(.tertiary)
                    .italic()
            } else {
                Text(statusLine)
                    .font(.zenMeta)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var statusLine: String {
        "\(row.rollupStatus ?? row.status) · goal \(row.capabilityMet)/\(row.capabilityTotal) · build \(row.mechanicalDone)/\(row.mechanicalTotal)"
    }
}

/// The empty state doubles as the ESCAPE HATCH from a bad pairing.
///
/// Before this, the only route back to PairingView was `unpair()`, which fires when a
/// call returns 401. An unreachable server never returns 401 — it times out — so a
/// phone paired to a host it cannot reach sat on "Waiting to connect to the server"
/// forever with no way out (observed 2026-08-21 against the default localhost:9002,
/// which on a phone means the phone itself). Whenever we are not connected, offer both
/// a rescan and a full re-pair, and NAME the host being dialled so the fault is legible.
private struct EmptyState: View {
    let connected: Bool
    @EnvironmentObject var app: AppModel
    @EnvironmentObject var store: ZenStore
    @State private var showScanner = false

    var body: some View {
        VStack(spacing: Space.l) {
            Circle().fill(.quaternary).frame(width: 44, height: 44)
                .overlay(Image(systemName: connected ? "moon.zzz" : "wifi.slash")
                    .foregroundStyle(.secondary))
            Text(connected ? "No watched sessions yet" : "Can't reach the server")
                .font(.headline)
            Text(connected
                 ? "Add a session from the Collab dashboard."
                 : "Trying \(store.host). If that address is wrong, scan the QR from the desktop's Settings → Phone access panel.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Space.l)

            if !connected {
                VStack(spacing: Space.s) {
                    Button { showScanner = true } label: {
                        Label("Scan a new code", systemImage: "qrcode.viewfinder")
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.borderedProminent)

                    Button(role: .destructive) { app.unpair() } label: {
                        Text("Pair a different server")
                            .frame(maxWidth: .infinity).padding(.vertical, 12)
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal, Space.l)
                .frame(maxWidth: 420)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: $showScanner) {
            QRScannerView(onScan: { scanned in
                _ = app.handle(scanned: scanned)
                showScanner = false
            })
        }
    }
}

struct ZenCardView: View {
    let summary: ZenSummary
    let escalation: Escalation?
    let now: Double
    var onDrillIn: (ZenSummary) -> Void
    @EnvironmentObject var store: ZenStore
    @State private var expanded = false

    private var escOptions: [EscOption] { escalation?.options ?? [] }
    private var paneOptions: [ZenOption] { summary.structured?.options ?? [] }
    private var questionText: String? { escalation?.questionText ?? summary.structured?.question }
    private var showQuestion: Bool { !escOptions.isEmpty || !paneOptions.isEmpty }
    /// A "green" card = a session actively working (design: green card = approve & push).
    private var isGreen: Bool { summary.statusKey == "working" || summary.statusKey == "active" }

    private var zenStatus: ZenStatus { ZenStatus(statusKey: summary.statusKey) }
    private var railOpacity: CGFloat {
        summary.statusKey == "needs-input" || summary.statusKey == "asking" ||
        summary.statusKey == "stuck" || summary.statusKey == "wedged" ? 1.0 : 0.5
    }

    var body: some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(zenStatus.accent.opacity(railOpacity))
                .frame(width: 3)

            VStack(alignment: .leading, spacing: Space.m) {
                // Project eyebrow
                Text(summary.projectName.uppercased())
                    .font(.zenProjectEyebrow)
                    .foregroundStyle(.secondary).lineLimit(1)

                // Session name with status dot and label
                HStack(spacing: Space.xs) {
                    Circle().fill(zenStatus.accent).frame(width: 7, height: 7)
                    Text(summary.sessionName)
                        .font(.zenSessionName)
                    Text(zenStatus.label)
                        .font(.zenMeta).foregroundStyle(.secondary)
                    Spacer()
                    Button { onDrillIn(summary) } label: {
                        Image(systemName: "chevron.right.circle")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open mission detail")
                }

                // Glance/detail
                if summary.paragraph.isEmpty {
                    Text("No summary yet · \(summary.statusLabel)")
                        .font(.callout).italic().foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity)
                } else {
                    Text(expanded ? summary.expanded : summary.glance)
                        .font(.zenGlance).lineSpacing(6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if summary.hasMore {
                        Text(expanded ? "less" : "more")
                            .font(.caption2).fontWeight(.semibold).foregroundStyle(.tint)
                            .frame(maxWidth: .infinity)
                    }
                }

                // Question + answers (only when the session is asking)
                if showQuestion {
                    VStack(spacing: Space.m) {
                        if let q = questionText {
                            Text(q).font(.subheadline).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        answerButtons
                    }
                }

                // Green, not asking → the one act: approve & push (hold to confirm)
                if isGreen && !showQuestion {
                    ApprovePushButton {
                        store.approvePush(project: summary.project, session: summary.session)
                    }
                }
            }
            .padding(Space.l).frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .onTapGesture { if summary.hasMore { Haptics.tick(); withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) { expanded.toggle() } } }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .fill(zenStatus.accent.opacity(min(summary.freshnessOpacity(now: now), 0.10)))
        )
        .zenCard()
    }

    @ViewBuilder private var answerButtons: some View {
        // Wrapping flow of pill buttons.
        FlowLayout(spacing: 8) {
            if !escOptions.isEmpty {
                ForEach(escOptions) { opt in
                    answerPill(opt.label, recommended: escalation?.recommended == opt.id) {
                        Haptics.tick()
                        if let id = escalation?.id { store.decide(id, optionId: opt.id) }
                    }
                }
            } else {
                ForEach(Array(paneOptions.enumerated()), id: \.offset) { i, opt in
                    answerPill(opt.label, recommended: i == summary.structured?.recommended) {
                        Haptics.tick()
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
                if recommended { Image(systemName: "star.fill").font(.caption2).foregroundStyle(zenStatus.accent) }
            }
            .padding(.horizontal, Space.m).padding(.vertical, Space.s)
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

/// Deliberate, intentional haptics (Emil's craft §7): a soft tick for light acts, a
/// firmer success for the consequential approve/push. No-op is fine on the simulator.
enum Haptics {
    static func tick() {
        let g = UIImpactFeedbackGenerator(style: .light); g.prepare(); g.impactOccurred()
    }
    static func success() {
        let g = UINotificationFeedbackGenerator(); g.prepare(); g.notificationOccurred(.success)
    }
}

/// The green card's single 'act': hold-to-confirm approve & push (design §2 Q1 — a push is
/// consequential, so it is guarded by a hold, not a tap). Fills over ~0.6s; completing the
/// hold fires `action` with a success haptic. Honors Reduce Motion (the fill still tracks
/// the press, just without the spring flourish).
struct ApprovePushButton: View {
    var action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var progress: CGFloat = 0
    @State private var firing = false
    private let holdDuration: Double = 0.6
    private let accentColor = ZenStatus(statusKey: "working").accent

    var body: some View {
        ZStack {
            Capsule().fill(accentColor.opacity(0.14))
            GeometryReader { geo in
                Capsule().fill(accentColor.opacity(0.28))
                    .frame(width: geo.size.width * progress)
            }
            .clipShape(Capsule())
            HStack(spacing: Space.s) {
                Image(systemName: "checkmark.circle.fill")
                Text(firing ? "Pushing…" : "Hold to approve & push").font(.subheadline).fontWeight(.semibold)
            }
            .foregroundStyle(accentColor)
        }
        .frame(height: Space.xl)
        .overlay(Capsule().strokeBorder(accentColor.opacity(0.5)))
        .contentShape(Capsule())
        .gesture(
            LongPressGesture(minimumDuration: holdDuration)
                .onChanged { _ in
                    withAnimation(reduceMotion ? .linear(duration: holdDuration) : .easeIn(duration: holdDuration)) {
                        progress = 1
                    }
                }
                .onEnded { _ in
                    firing = true
                    Haptics.success()
                    action()
                    // brief confirmation, then reset
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) {
                        withAnimation(.easeOut(duration: 0.25)) { progress = 0 }
                        firing = false
                    }
                }
        )
        .simultaneousGesture(
            // Reset the fill if the press is released before completing.
            DragGesture(minimumDistance: 0).onEnded { _ in
                if !firing { withAnimation(.easeOut(duration: 0.2)) { progress = 0 } }
            }
        )
        .accessibilityLabel("Approve and push. Double tap and hold to confirm.")
    }
}
