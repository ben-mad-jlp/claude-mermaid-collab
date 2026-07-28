import XCTest
@testable import MermaidCollabCore

final class PairingLinkTests: XCTestCase {
    func testParsesValidDeepLink() {
        let link = PairingLink.parse("mermaidcollab://pair?host=192.168.1.10:9002&token=abc123")
        XCTAssertNotNil(link)
        XCTAssertEqual(link?.host, "192.168.1.10")
        XCTAssertEqual(link?.port, 9002)
        XCTAssertEqual(link?.token, "abc123")
    }

    func testDefaultsPortWhenOmitted() {
        let link = PairingLink.parse("mermaidcollab://pair?host=192.168.1.10&token=abc123")
        XCTAssertNotNil(link)
        XCTAssertEqual(link?.host, "192.168.1.10")
        XCTAssertEqual(link?.port, 9002)
        XCTAssertEqual(link?.token, "abc123")
    }

    func testStripsSchemePrefixFromHost() {
        let link = PairingLink.parse("mermaidcollab://pair?host=http://192.168.1.10:9002&token=abc123")
        XCTAssertNotNil(link)
        XCTAssertEqual(link?.host, "192.168.1.10")
        XCTAssertEqual(link?.port, 9002)
        XCTAssertEqual(link?.token, "abc123")
    }

    func testRejectsWrongScheme() {
        let link = PairingLink.parse("https://pair?host=192.168.1.10:9002&token=abc123")
        XCTAssertNil(link)
    }

    func testRejectsMissingToken() {
        let link = PairingLink.parse("mermaidcollab://pair?host=192.168.1.10:9002")
        XCTAssertNil(link)
    }

    func testRejectsMissingHost() {
        let link = PairingLink.parse("mermaidcollab://pair?token=abc123")
        XCTAssertNil(link)
    }

    func testRejectsNonNumericPort() {
        let link = PairingLink.parse("mermaidcollab://pair?host=192.168.1.10:abc&token=abc123")
        XCTAssertNil(link)
    }
}
