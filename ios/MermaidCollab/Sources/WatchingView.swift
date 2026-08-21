import SwiftUI
import MermaidCollabCore

/// The watching surface: per registered server, which projects and sessions this phone
/// watches, plus a way to add a new project by path. Reads `store.projectsByServerId`
/// (populated by `refreshProjects()`) for project rows and `store.watchList.entries` for
/// session toggle state — `watchList` is stamped only by the session verbs, so project-row
/// presence is never derived from it.
struct WatchingView: View {
    @EnvironmentObject var store: ZenStore
    @State private var newProject: String = ""

    var body: some View {
        List {
            ForEach(store.registry.entries, id: \.id) { entry in
                Section(entry.label) {
                    let projects = store.projectsByServerId[entry.id] ?? []
                    if projects.isEmpty {
                        Text("No watched projects.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(projects, id: \.self) { project in
                            projectRow(entry: entry, project: project)
                        }
                    }
                }
            }

            Section {
                HStack {
                    TextField("Project path", text: $newProject)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Add") {
                        let trimmed = newProject.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return }
                        Task { await store.watchProject(trimmed) }
                        newProject = ""
                    }
                    .disabled(newProject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("watch-project-add-button")
                }
            }
        }
        .navigationTitle("Watching")
    }

    @ViewBuilder
    private func projectRow(entry: ServerEntry, project: String) -> some View {
        VStack(alignment: .leading) {
            Text(project)
                .accessibilityIdentifier("watching-project-\(project)")

            let sessions = store.summaries.values
                .filter { $0.project == project }
                .map(\.session)
                .sorted()
            ForEach(sessions, id: \.self) { session in
                Toggle(
                    session,
                    isOn: Binding(
                        get: {
                            store.watchList.entries.contains {
                                $0.serverId == entry.id && $0.project == project && $0.session == session
                            }
                        },
                        set: { isOn in
                            if isOn {
                                Task { await store.watchSession(project: project, session: session) }
                            } else {
                                Task { await store.unwatchSession(project: project, session: session) }
                            }
                        }
                    )
                )
                .accessibilityIdentifier("watching-session-\(project)-\(session)")
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                Task { await store.unwatchProject(project) }
            } label: {
                Label("Unwatch", systemImage: "trash")
            }
        }
    }
}
