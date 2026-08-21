import SwiftUI
import MermaidCollabCore

/// The fleet: every registered server, which one is selected, and how to add another.
///
/// This was previously read-only AND unreferenced — a list nothing in the app could reach,
/// so a phone could pair exactly one machine and had no way to see or add a second
/// (2026-08-21). Servers are added ONE QR AT A TIME (operator decision, same day): each
/// desktop server row shows its own code, and scanning here MERGES that server into the
/// registry rather than replacing what is already paired.
struct ServerPickerView: View {
    @EnvironmentObject var store: ZenStore
    @EnvironmentObject var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var showScanner = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if store.registry.entries.isEmpty {
                        Text("No servers registered yet.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(
                            ServerPickerRow.rows(registry: store.registry, projectsByServerId: store.projectsByServerId),
                            id: \.id
                        ) { row in
                            Button {
                                store.selectServer(row.id)
                                dismiss()
                            } label: {
                                HStack {
                                    Image(systemName: row.id == store.selectedServerId ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(row.id == store.selectedServerId ? Color.accentColor : Color.secondary)
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
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("server-row-\(row.id)")
                        }
                    }
                }

                Section {
                    Button {
                        showScanner = true
                    } label: {
                        Label("Add a server", systemImage: "qrcode.viewfinder")
                    }
                    .accessibilityIdentifier("add-server-button")
                } footer: {
                    Text("On the desktop, press the info button beside a server and scan its code. One server per code.")
                }
            }
            .navigationTitle("Servers")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .sheet(isPresented: $showScanner) {
            QRScannerView(onScan: { scanned in
                _ = app.handle(scanned: scanned)
                showScanner = false
            })
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
