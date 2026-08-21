import XCTest
@testable import MermaidCollabCore

final class ServerScreenStateTests: XCTestCase {
    func test1_unreachableEntryDerivesTheUnreachableCase() {
        let entry = ServerEntry(
            id: "srv-a", label: "Alpha", host: "10.0.0.1:9002", source: .manual,
            reachability: .unreachable
        )

        let state = ServerScreenState.state(for: entry, itemCount: 3)

        XCTAssertEqual(state, .unreachable)
    }

    func test2_unauthorizedEntryDerivesTheUnauthorizedCase() {
        let entry = ServerEntry(
            id: "srv-a", label: "Alpha", host: "10.0.0.1:9002", source: .manual,
            reachability: .unauthorized
        )

        let state = ServerScreenState.state(for: entry, itemCount: 0)

        XCTAssertEqual(state, .unauthorized)
    }

    func test3_reachableEntryWithEmptyPayloadDerivesACaseDistinctFromBoth() {
        let entry = ServerEntry(
            id: "srv-a", label: "Alpha", host: "10.0.0.1:9002", source: .manual,
            reachability: .reachable
        )

        let state = ServerScreenState.state(for: entry, itemCount: 0)

        XCTAssertEqual(state, .empty)
        XCTAssertNotEqual(state, .unreachable)
        XCTAssertNotEqual(state, .unauthorized)
    }
}
