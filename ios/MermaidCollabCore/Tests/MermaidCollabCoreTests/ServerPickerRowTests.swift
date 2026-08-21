import XCTest
@testable import MermaidCollabCore

final class ServerPickerRowTests: XCTestCase {
    func test1_rowCarriesEntryLabel() {
        let entry = ServerEntry(id: "srv-a", label: "Alpha", host: "10.0.0.1:9002", source: .manual)
        let registry = ServerRegistry(entries: [entry])

        let rows = ServerPickerRow.rows(registry: registry, projectsByServerId: [:])

        XCTAssertEqual(rows[0].label, "Alpha")
    }

    func test2_rowCarriesReachabilityStampedFromTheSharedPoll() {
        let entry = ServerEntry(id: "srv-a", label: "Alpha", host: "10.0.0.1:9002", source: .manual)
        let registry = ServerRegistry(entries: [entry])
            .applyingProbeResults(["srv-a": .httpStatus(200)])

        let rows = ServerPickerRow.rows(registry: registry, projectsByServerId: [:])

        XCTAssertEqual(rows[0].reachability, .reachable)
    }

    func test3_rowCarriesProjectCountEqualToThatServersProjectListLength() {
        let a = ServerEntry(id: "srv-a", label: "Alpha", host: "10.0.0.1:9002", source: .manual)
        let b = ServerEntry(id: "srv-b", label: "Beta", host: "10.0.0.2:9003", source: .manual)
        let registry = ServerRegistry(entries: [a, b])

        let rows = ServerPickerRow.rows(
            registry: registry,
            projectsByServerId: ["srv-a": ["p1", "p2"]]
        )

        XCTAssertEqual(rows[0].projectCount, 2)
        XCTAssertEqual(rows[1].projectCount, 0)
    }
}
