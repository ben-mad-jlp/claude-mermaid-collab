import SwiftUI
import MermaidCollabCore

struct MissionDetailView: View {
    let project: String
    let session: String
    var missionId: String? = nil
    var row: MissionListRow? = nil
    @EnvironmentObject var store: ZenStore
    @State private var mission: MissionSummary?
    @State private var diagnostic: MissionDiagnostic?

    var body: some View {
        NavigationStack {
            Group {
                if row != nil || mission != nil {
                    loaded()
                } else {
                    ProgressView("Loading mission…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle("Mission")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            if row == nil {
                mission = await store.fetchMission(project: project, session: session)
            }
            if let mid = missionId ?? row?.id ?? mission?.node.id {
                diagnostic = await store.fetchMissionDiagnostic(project: project, missionId: mid)
            }
        }
    }

    @ViewBuilder private func loaded() -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.l) {
                // Goal / mission title
                Text(row?.title ?? mission?.node.title ?? "Mission")
                    .font(.title2).fontWeight(.semibold)
                    .frame(maxWidth: .infinity, alignment: .leading)

                // Status pill from the row's rollup, else the fetched mission's rollup
                statusPill(row?.rollupStatus ?? row?.status ?? mission?.rollup.status ?? "unknown")

                // Gauges
                HStack(spacing: Space.l) {
                    if let row {
                        gauge(title: "Goal", value: row.capabilityMet, total: row.capabilityTotal)
                        gauge(title: "Build", value: row.mechanicalDone, total: row.mechanicalTotal)
                    } else if let m = mission {
                        gauge(title: "Goal",
                              value: m.rollup.capability.met,
                              total: m.rollup.capability.total)
                        gauge(title: "Build",
                              value: m.rollup.mechanical.done,
                              total: m.rollup.mechanical.total)
                    }
                }

                // Criteria list, driven by the diagnostic — never the list rollup.
                VStack(alignment: .leading, spacing: Space.s) {
                    if diagnostic != nil {
                        ForEach(diagnostic?.criteria ?? [], id: \.id) { c in
                            HStack(alignment: .top, spacing: Space.s) {
                                Image(systemName: c.met ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(c.met ? Color.green : Color.secondary)
                                Text("\(c.id.prefix(8)) · \(c.action)").font(.subheadline)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    } else {
                        Text("Criteria unavailable")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                // Plan tree — one section per serving epic, its leaves underneath.
                if let diagnostic {
                    VStack(alignment: .leading, spacing: Space.m) {
                        ForEach(MissionPlanTree.build(from: diagnostic), id: \.id) { node in
                            VStack(alignment: .leading, spacing: Space.xs) {
                                Text(node.title).font(.zenSessionName)
                                ForEach(node.children, id: \.id) { leaf in
                                    HStack(spacing: Space.s) {
                                        Text(leaf.derivedStatus).font(.subheadline)
                                        Text(leaf.terminalClass)
                                            .font(.zenMeta)
                                            .foregroundStyle(.secondary)
                                    }
                                    .padding(.leading, Space.m)
                                }
                            }
                        }
                    }
                }

                NavigationLink("Artifacts") {
                    ArtifactListView(project: project, session: session)
                }

                NavigationLink("Recent transcript") {
                    TranscriptPeekView(project: project, session: session)
                }
            }
            .padding(Space.l)
        }
    }

    private func statusPill(_ status: String) -> some View {
        let zs = ZenStatus(statusKey: status)
        return HStack(spacing: Space.xs) {
            Image(systemName: zs.symbol)
            Text(status)
        }
        .font(.zenMeta)
        .padding(.horizontal, Space.m).padding(.vertical, Space.xs)
        .background(Capsule().fill(zs.accent.opacity(0.18)))
        .overlay(Capsule().strokeBorder(zs.accent.opacity(0.5)))
        .foregroundStyle(zs.accent)
    }

    private func gauge(title: String, value: Int, total: Int) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(title.uppercased()).font(.zenProjectEyebrow).foregroundStyle(.secondary)
            Text("\(value)/\(total)").font(.title3).fontWeight(.semibold)
            ProgressView(value: Double(value), total: Double(max(total, 1)))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
