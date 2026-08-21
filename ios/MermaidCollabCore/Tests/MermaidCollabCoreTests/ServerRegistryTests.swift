import XCTest
@testable import MermaidCollabCore

final class ServerRegistryTests: XCTestCase {
    func testRegistryRoundTripPreservesEntriesAndOrder() throws {
        let entryC = ServerEntry(id: "c", label: "C", host: "10.0.0.1:9002", source: .manual)
        let entryA = ServerEntry(id: "a", label: "A", host: "10.0.0.2:9002", source: .manual)
        let entryB = ServerEntry(id: "b", label: "B", host: "10.0.0.3:9002", source: .manual)
        let original = ServerRegistry(entries: [entryC, entryA, entryB])

        let data = try original.encoded()
        let decoded = try ServerRegistry.decoded(from: data)

        XCTAssertEqual(decoded.entries, original.entries)
        for (i, e) in original.entries.enumerated() {
            XCTAssertEqual(decoded.entries[i].id, e.id)
        }
        XCTAssertEqual(decoded.entries.map(\.id), ["c", "a", "b"])
    }

    func testDecodedEntryPreservesEveryField() throws {
        let pairing = PairingLink(host: "192.168.1.10", port: 9002, token: "abc123")
        let entry = ServerEntry(
            id: "server-1",
            label: "My Server",
            host: "192.168.1.10:9002",
            source: .manual,
            pairing: pairing,
            reachability: .unauthorized
        )
        let registry = ServerRegistry(entries: [entry])

        let data = try registry.encoded()
        let decoded = try ServerRegistry.decoded(from: data)
        let decodedEntry = try XCTUnwrap(decoded.entries.first)

        XCTAssertEqual(decodedEntry.id, entry.id)
        XCTAssertEqual(decodedEntry.label, entry.label)
        XCTAssertEqual(decodedEntry.host, entry.host)
        XCTAssertEqual(decodedEntry.source, entry.source)
        XCTAssertEqual(decodedEntry.pairing, entry.pairing)
        XCTAssertEqual(decodedEntry.reachability, entry.reachability)
    }
}
