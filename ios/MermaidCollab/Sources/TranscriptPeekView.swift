import SwiftUI

struct TranscriptPeekView: View {
    let project: String
    let session: String
    @EnvironmentObject var store: ZenStore
    @State private var response: TranscriptResponse?

    var body: some View {
        Group {
            if let r = response {
                if r.found && !r.turns.isEmpty {
                    ScrollView {
                        VStack(alignment: .leading, spacing: Space.m) {
                            ForEach(r.turns) { turn in
                                turnCard(turn)
                            }
                        }
                        .padding(Space.l)
                    }
                } else {
                    Text("No recent transcript")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else {
                ProgressView("Loading transcript…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Transcript")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            response = await store.fetchTranscript(project: project, session: session)
        }
    }

    @ViewBuilder private func turnCard(_ turn: TranscriptTurn) -> some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text(roleLabel(turn.role))
                .font(.zenMeta)
                .foregroundStyle(turn.role == "user" ? Color.accentColor : .secondary)
            Text(turn.text)
                .font(.body.monospaced())
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(Space.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .zenCard()
    }

    private func roleLabel(_ role: String) -> String {
        role == "user" ? "You" : "Claude"
    }
}
