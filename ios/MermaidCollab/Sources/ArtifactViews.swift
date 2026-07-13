import SwiftUI
import UIKit

struct ArtifactListView: View {
    let project: String
    let session: String
    @EnvironmentObject var store: ZenStore
    @State private var documents: [DocRef] = []
    @State private var images: [ImageRef] = []

    var body: some View {
        List {
            if documents.isEmpty && images.isEmpty {
                Text("No artifacts yet")
                    .foregroundStyle(.secondary)
            } else {
                if !documents.isEmpty {
                    Section("Documents") {
                        ForEach(documents) { doc in
                            NavigationLink(doc.name) {
                                DocumentView(id: doc.id, project: project, session: session)
                            }
                        }
                    }
                }
                if !images.isEmpty {
                    Section("Images") {
                        ForEach(images) { img in
                            NavigationLink(img.name) {
                                ImageView(id: img.id, project: project, session: session)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Artifacts")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            documents = await store.fetchDocuments(project: project, session: session)
            images = await store.fetchImages(project: project, session: session)
        }
    }
}

struct DocumentView: View {
    let id: String
    let project: String
    let session: String
    @EnvironmentObject var store: ZenStore
    @State private var doc: DocumentContent?

    var body: some View {
        Group {
            if let doc {
                ScrollView {
                    Text(LocalizedStringKey(doc.content))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Space.l)
                }
            } else {
                ProgressView("Loading…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(doc?.name ?? "Document")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            doc = await store.fetchDocument(id: id, project: project, session: session)
        }
    }
}

struct ImageView: View {
    let id: String
    let project: String
    let session: String
    @EnvironmentObject var store: ZenStore
    @State private var data: Data?
    @State private var loaded = false

    var body: some View {
        Group {
            if let data, let uiImage = UIImage(data: data) {
                ScrollView {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity)
                        .padding(Space.l)
                }
            } else if loaded {
                Text("Could not load image")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Loading…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Image")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            data = await store.fetchImageData(id: id, project: project, session: session)
            loaded = true
        }
    }
}
