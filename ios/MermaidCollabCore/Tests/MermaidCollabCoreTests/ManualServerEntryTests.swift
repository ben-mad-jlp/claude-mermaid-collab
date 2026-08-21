import XCTest
@testable import MermaidCollabCore

final class ManualServerEntryTests: XCTestCase {
    func test1_entryBuiltFromHostStringCarriesThatHost() throws {
        let entry = ManualServerEntry.entry(
            host: "trimaxion.tail445728.ts.net:9002",
            token: "tok",
            id: "manual-1"
        )

        XCTAssertEqual(entry.host, "trimaxion.tail445728.ts.net:9002")
    }

    func test2_sourceEqualsManual() throws {
        let entry = ManualServerEntry.entry(
            host: "trimaxion.tail445728.ts.net:9002",
            token: "tok",
            id: "manual-1"
        )

        XCTAssertEqual(entry.source, .manual)
    }

    func test3_addingToRegistryHoldingTheLocalEntryYieldsTwoEntries() throws {
        var registry = ServerRegistry(entries: [
            ServerEntry(id: "local", label: "This Mac", host: "localhost:9002", source: .manual)
        ])

        let entry = ManualServerEntry.entry(
            host: "trimaxion.tail445728.ts.net:9002",
            token: "tok",
            id: "manual-1"
        )
        registry.entries.append(entry)

        XCTAssertEqual(registry.entries.count, 2)
    }
}
