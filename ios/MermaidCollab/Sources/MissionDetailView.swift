import SwiftUI

struct MissionDetailView: View {
    let project: String
    let session: String
    @EnvironmentObject var store: ZenStore
    @State private var mission: MissionSummary?

    var body: some View {
        NavigationStack {
            Group {
                if let m = mission {
                    loaded(m)
                } else {
                    ProgressView("Loading mission…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle("Mission")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            mission = await store.fetchMission(project: project, session: session)
        }
    }

    @ViewBuilder private func loaded(_ m: MissionSummary) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Space.l) {
                // Goal / mission title
                Text(m.node.title)
                    .font(.title2).fontWeight(.semibold)
                    .frame(maxWidth: .infinity, alignment: .leading)

                // Status pill from rollup.status
                statusPill(m.rollup.status)

                // Gauges
                HStack(spacing: Space.l) {
                    gauge(title: "Goal",
                          value: m.rollup.capability.met,
                          total: m.rollup.capability.total)
                    gauge(title: "Build",
                          value: m.rollup.mechanical.done,
                          total: m.rollup.mechanical.total)
                }

                // Criteria list
                VStack(alignment: .leading, spacing: Space.s) {
                    ForEach(m.criteria) { c in
                        HStack(alignment: .top, spacing: Space.s) {
                            Image(systemName: c.met ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(c.met ? Color.green : Color.secondary)
                            Text(c.text).font(.subheadline)
                                .frame(maxWidth: .infinity, alignment: .leading)
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
