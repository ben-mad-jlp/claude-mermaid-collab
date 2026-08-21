import XCTest
@testable import MermaidCollabCore

final class PairingPayloadVersion2Tests: XCTestCase {
    private func multiEntryPayloadURL(json: String) -> String {
        let base64 = Data(json.utf8).base64EncodedString()
        var comps = URLComponents()
        comps.scheme = "mermaidcollab"
        comps.host = "pair"
        comps.queryItems = [URLQueryItem(name: "servers", value: base64)]
        return comps.url!.absoluteString
    }

    func test1_versionTwoPayloadWithTwoServersYieldsTwoCredentials() throws {
        let json = """
        {
          "version": 2,
          "servers": [
            {"id": "srv-a", "label": "Alpha", "host": "10.0.0.1:9002", "token": "tok-a"},
            {"id": "srv-b", "label": "Beta", "host": "10.0.0.2:9003", "token": "tok-b"}
          ]
        }
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
    }

    func test2_legacySingleHostQueryFormYieldsOneCredentialWhoseHostEqualsTheHostQueryValue() throws {
        let urlString = "mermaidcollab://pair?host=192.168.1.5&token=tok-single"

        let payload = try XCTUnwrap(PairingLink.parsePayload(urlString))
        XCTAssertEqual(payload.servers.count, 1)
        XCTAssertEqual(payload.servers[0].host, "192.168.1.5")
    }

    func test3_versionTwoPayloadWithOneServerYieldsOneCredential() throws {
        let json = """
        {
          "version": 2,
          "servers": [
            {"id": "srv-solo", "label": "Solo", "host": "10.0.0.5:9002", "token": "tok-solo"}
          ]
        }
        """
        let urlString = multiEntryPayloadURL(json: json)

        let payload = try XCTUnwrap(PairingLink.parsePayload(urlString))
        XCTAssertEqual(payload.servers.count, 1)
        XCTAssertEqual(payload.servers[0].id, "srv-solo")
        XCTAssertEqual(payload.servers[0].host, "10.0.0.5")
        XCTAssertEqual(payload.servers[0].port, 9002)
        XCTAssertEqual(payload.servers[0].token, "tok-solo")
    }
}
