import XCTest
@testable import MermaidCollabCore

final class ReachabilityTests: XCTestCase {
    func testHttpTwoHundredMapsToReachable() {
        XCTAssertEqual(reachabilityState(from: .httpStatus(200)), .reachable)
    }

    func testHttpFourOhOneMapsToUnauthorized() {
        XCTAssertEqual(reachabilityState(from: .httpStatus(401)), .unauthorized)
    }

    func testTransportFailureMapsToUnreachable() {
        XCTAssertEqual(reachabilityState(from: .transportFailure("connection refused")), .unreachable)
    }

    func testOneSharedPollStampsEveryRegistryEntry() {
        let entryA = ServerEntry(id: "a", label: "A", host: "10.0.0.1:9002", source: .manual)
        let entryB = ServerEntry(id: "b", label: "B", host: "10.0.0.2:9002", source: .manual)
        let entryC = ServerEntry(id: "c", label: "C", host: "10.0.0.3:9002", source: .manual)
        let registry = ServerRegistry(entries: [entryA, entryB, entryC])

        let results: [String: ServerProbeResult] = [
            "a": .httpStatus(200),
            "b": .httpStatus(401),
            "c": .transportFailure("timed out"),
        ]

        let result = registry.applyingProbeResults(results)

        XCTAssertEqual(result.entries.map(\.reachability), [.reachable, .unauthorized, .unreachable])
    }
}
