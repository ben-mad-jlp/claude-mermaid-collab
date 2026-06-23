import SwiftUI

@main
struct MermaidCollabApp: App {
    @StateObject private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if app.credentials == nil {
                    PairingView()
                } else {
                    ContentView()
                }
            }
            .environmentObject(app)
            .environmentObject(app.store)
            // mermaidcollab://pair?host=…&token=… from the desktop QR (scanned in Camera).
            .onOpenURL { app.handle(url: $0) }
        }
    }
}
