import XCTest
@testable import MermaidCollabCore

final class ProjectOwnershipTests: XCTestCase {
    func testClaimedProjectResolvesToClaimingServer() {
        let projectsByServerId = [
            "claimer": ["/Users/ben/project-a"],
            "other": ["/Users/ben/project-b"],
        ]

        let result = ProjectOwnership.owner(
            ofProject: "/Users/ben/project-a",
            projectsByServerId: projectsByServerId,
            localServerId: nil,
            fallbackServerId: "fallback"
        )

        XCTAssertEqual(result, "claimer")
        XCTAssertNotEqual(result, "fallback")
    }

    func testDoubleClaimedProjectPrefersLocalServer() {
        let projectsByServerId = [
            "a": ["/Users/ben/project-shared"],
            "z": ["/Users/ben/project-shared"],
        ]

        let result = ProjectOwnership.owner(
            ofProject: "/Users/ben/project-shared",
            projectsByServerId: projectsByServerId,
            localServerId: "z",
            fallbackServerId: "fallback"
        )

        XCTAssertEqual(result, "z")
    }

    func testUnclaimedProjectReturnsFallback() {
        let projectsByServerId = [
            "a": ["/Users/ben/project-a"],
            "b": ["/Users/ben/project-b"],
        ]

        let result = ProjectOwnership.owner(
            ofProject: "/Users/ben/project-unclaimed",
            projectsByServerId: projectsByServerId,
            localServerId: "a",
            fallbackServerId: "fallback"
        )

        XCTAssertEqual(result, "fallback")
    }
}
