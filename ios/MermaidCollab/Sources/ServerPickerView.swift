import SwiftUI
import MermaidCollabCore

/// Read-only list of registered servers: label, reachability, and how many projects each owns.
/// No writes to `store.selectedServerId`, no network call, no `applyingProbeResults` call —
/// this view only renders the current registry state on redraw.
struct ServerPickerView: View {
    @EnvironmentObject var store: ZenStore

    var body: some View {
        List {
            if store.registry.entries.isEmpty {
                Text("No servers registered yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(
                    ServerPickerRow.rows(registry: store.registry, projectsByServerId: store.projectsByServerId),
                    id: \.id
                ) { row in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(row.label)
                            Text("\(row.projectCount) project\(row.projectCount == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        reachabilityIndicator(row.reachability)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func reachabilityIndicator(_ reachability: ServerReachability) -> some View {
        switch reachability {
        case .reachable:
            Label("Reachable", systemImage: "checkmark.circle.fill")
                .labelStyle(.iconOnly)
                .foregroundStyle(.green)
        case .unreachable:
            Label("Unreachable", systemImage: "xmark.circle")
                .labelStyle(.iconOnly)
                .foregroundStyle(.secondary)
        case .unauthorized:
            Label("Unauthorized", systemImage: "lock.trianglebadge.exclamationmark")
                .labelStyle(.iconOnly)
                .foregroundStyle(.orange)
        }
    }
}
