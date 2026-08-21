import XCTest
@testable import MermaidCollabCore

final class PairingImportTests: XCTestCase {
    private func multiEntryPayloadURL(json: String) -> String {
        let base64 = Data(json.utf8).base64EncodedString()
        var comps = URLComponents()
        comps.scheme = "mermaidcollab"
        comps.host = "pair"
        comps.queryItems = [URLQueryItem(name: "servers", value: base64)]
        return comps.url!.absoluteString
    }

    func test1_twoServerPayloadOverOneServerRegistryYieldsThreeEntries() throws {
        let existing = ServerEntry(id: "existing", label: "Existing", host: "10.0.0.9:9002", source: .manual)
        let registry = ServerRegistry(entries: [existing])

        let json = """
        [
          {"id": "srv-a", "label": "Alpha", "host": "10.0.0.1:9002", "token": "tok-a"},
          {"id": "srv-b", "label": "Beta", "host": "10.0.0.2:9003", "token": "tok-b"}
        ]
        """
        let payload = try XCTUnwrap(PairingLink.parsePayload(multiEntryPayloadURL(json: json)))

        let merged = registry.merging(payload)
        XCTAssertEqual(merged.entries.count, 3)
    }

    func test2_matchingIdUpsertsInPlaceAndAdoptsPayloadHostPort() throws {
        let existing = ServerEntry(id: "mac", label: "Mac", host: "192.168.1.5:9002", source: .manual)
        let registry = ServerRegistry(entries: [existing])

        let json = """
        [
          {"id": "mac", "label": "Mac", "host": "tail-mac:9002", "token": "tok-mac"}
        ]
        """
        let payload = try XCTUnwrap(PairingLink.parsePayload(multiEntryPayloadURL(json: json)))

        let merged = registry.merging(payload)
        XCTAssertEqual(merged.entries.count, 1)
        XCTAssertEqual(merged.entries[0].host, "tail-mac:9002")
    }

    func test3_singleEntryLinkPayloadParsesExactlyOneServer() throws {
        let payload = try XCTUnwrap(PairingLink.parsePayload("mermaidcollab://pair?host=1.2.3.4:9002&token=t"))
        XCTAssertEqual(payload.servers.count, 1)
    }
}
