import XCTest
@testable import MermaidCollabCore

final class ServerRegistryStoreTests: XCTestCase {
    private var url: URL!

    override func setUp() {
        super.setUp()
        url = FileManager.default.temporaryDirectory
            .appendingPathComponent("ServerRegistryStoreTests-\(UUID().uuidString).json")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: url)
        url = nil
        super.tearDown()
    }

    func test1_writtenRegistryReadsBackWithSameEntryIdsInOrder() {
        let store = FileServerRegistryStore(url: url)
        let registry = ServerRegistry(entries: [
            ServerEntry(id: "a", label: "A", host: "a:9002", source: .manual),
            ServerEntry(id: "b", label: "B", host: "b:9002", source: .paired)
        ])
        store.save(registry)

        let loaded = store.load()

        XCTAssertEqual(loaded.entries.map(\.id), ["a", "b"])
    }

    func test2_secondSaveOverwritesTheFirst() {
        let store = FileServerRegistryStore(url: url)
        let registryA = ServerRegistry(entries: [
            ServerEntry(id: "a", label: "A", host: "a:9002", source: .manual)
        ])
        let registryB = ServerRegistry(entries: [
            ServerEntry(id: "b", label: "B", host: "b:9002", source: .paired),
            ServerEntry(id: "c", label: "C", host: "c:9002", source: .paired)
        ])
        store.save(registryA)
        store.save(registryB)

        let loaded = store.load()

        XCTAssertEqual(loaded.entries.map(\.id), ["b", "c"])
    }

    func test3_neverWrittenStoreYieldsSingleDefaultEntry() {
        let store = FileServerRegistryStore(url: url)

        let loaded = store.load()

        XCTAssertEqual(loaded.entries.count, 1)
    }
}
