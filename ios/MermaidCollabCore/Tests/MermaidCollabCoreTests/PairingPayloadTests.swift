import XCTest
@testable import MermaidCollabCore

final class PairingPayloadTests: XCTestCase {
    private func multiEntryPayloadURL(json: String) -> String {
        let base64 = Data(json.utf8).base64EncodedString()
        var comps = URLComponents()
        comps.scheme = "mermaidcollab"
        comps.host = "pair"
        comps.queryItems = [URLQueryItem(name: "servers", value: base64)]
        return comps.url!.absoluteString
    }

    func testMultiEntryPayloadYieldsOneRegistryEntryPerServer() throws {
        let json = """
        [
          {"id": "srv-a", "label": "Alpha", "host": "10.0.0.1:9002", "token": "tok-a"},
          {"id": "srv-b", "label": "Beta", "host": "10.0.0.2:9003", "token": "tok-b"}
        ]
        """
        let urlString = multiEntryPayloadURL(json: json)

        let payload = try XCTUnwrap(PairingLink.parsePayload(urlString))
        XCTAssertEqual(payload.servers.count, 2)

        XCTAssertEqual(payload.servers[0].id, "srv-a")
        XCTAssertEqual(payload.servers[0].label, "Alpha")
        XCTAssertEqual(payload.servers[0].host, "10.0.0.1")
        XCTAssertEqual(payload.servers[0].port, 9002)
        XCTAssertEqual(payload.servers[0].token, "tok-a")

        XCTAssertEqual(payload.servers[1].id, "srv-b")
        XCTAssertEqual(payload.servers[1].label, "Beta")
        XCTAssertEqual(payload.servers[1].host, "10.0.0.2")
        XCTAssertEqual(payload.servers[1].port, 9003)
        XCTAssertEqual(payload.servers[1].token, "tok-b")

        let registry = ServerRegistry().merging(payload)
        XCTAssertEqual(registry.entries.count, 2)
        XCTAssertEqual(registry.entries.map(\.id), ["srv-a", "srv-b"])
        XCTAssertEqual(registry.entries[0].host, "10.0.0.1:9002")
        XCTAssertEqual(registry.entries[1].host, "10.0.0.2:9003")
        XCTAssertEqual(registry.entries[0].source, .paired)
        XCTAssertEqual(registry.entries[1].source, .paired)
    }

    func testSingleEntryPayloadStillParses() throws {
        let urlString = "mermaidcollab://pair?host=192.168.1.5&token=tok-single"

        let payload = try XCTUnwrap(PairingLink.parsePayload(urlString))
        XCTAssertEqual(payload.servers.count, 1)

        let server = payload.servers[0]
        XCTAssertEqual(server.host, "192.168.1.5")
        XCTAssertEqual(server.port, 9002)
        XCTAssertEqual(server.token, "tok-single")

        // Same outcome as the pre-existing single-entry parser.
        let link = try XCTUnwrap(PairingLink.parse(urlString))
        XCTAssertEqual(server.host, link.host)
        XCTAssertEqual(server.port, link.port)
        XCTAssertEqual(server.token, link.token)
        XCTAssertEqual(server.id, link.hostPort)
    }

    func testImportingPayloadKeepsEntriesWhoseIdsAreAbsentFromThePayload() throws {
        let existingZ = ServerEntry(id: "srv-z", label: "Zeta", host: "192.168.0.9:9002", source: .manual)
        let existingA = ServerEntry(id: "srv-a", label: "OldAlpha", host: "10.0.0.1:9002", source: .manual)
        let registry = ServerRegistry(entries: [existingZ, existingA])

        let json = """
        [
          {"id": "srv-a", "label": "NewAlpha", "host": "10.0.0.9:9100", "token": "tok-a2"}
        ]
        """
        let urlString = multiEntryPayloadURL(json: json)
        let payload = try XCTUnwrap(PairingLink.parsePayload(urlString))

        let merged = registry.merging(payload)

        // Order preserved: srv-z stays first at its original index.
        XCTAssertEqual(merged.entries.map(\.id), ["srv-z", "srv-a"])

        let mergedZ = try XCTUnwrap(merged.entries.first(where: { $0.id == "srv-z" }))
        XCTAssertEqual(mergedZ.label, existingZ.label)
        XCTAssertEqual(mergedZ.host, existingZ.host)
        XCTAssertEqual(mergedZ.source, existingZ.source)

        let mergedA = try XCTUnwrap(merged.entries.first(where: { $0.id == "srv-a" }))
        XCTAssertEqual(mergedA.label, "NewAlpha")
        XCTAssertEqual(mergedA.host, "10.0.0.9:9100")
        XCTAssertEqual(mergedA.source, .paired)
    }
}
