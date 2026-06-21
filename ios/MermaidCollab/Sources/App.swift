import SwiftUI

@main
struct MermaidCollabApp: App {
    @StateObject private var store = ZenStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .onAppear { store.start() }
        }
    }
}
