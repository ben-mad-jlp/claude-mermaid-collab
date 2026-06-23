import XCTest
@testable import MermaidCollabCore

final class SelectorsTests: XCTestCase {
    let NOW: Double = 1_000_000
    let GONE: Double = 15 * 60_000

    func esc(_ id: String, gated: Bool? = nil) -> Escalation {
        Escalation(id: id, project: "p", session: "s", status: "open", createdAt: 0, operatorGated: gated)
    }
    func summ(_ session: String, _ state: ProgressState, paneSeenAt: Double = 0,
              snoozedUntil: Double? = nil, summaryUpdatedAt: Double? = nil, updatedAt: Double = 0) -> SessionSummary {
        SessionSummary(project: "p", session: session, progressState: state, paneSeenAt: paneSeenAt,
                       updatedAt: updatedAt, snoozedUntil: snoozedUntil, summaryUpdatedAt: summaryUpdatedAt)
    }
    func byKey(_ ss: SessionSummary...) -> [String: SessionSummary] {
        Dictionary(uniqueKeysWithValues: ss.map { ($0.key, $0) })
    }
    func fresh(live: Bool = true, lastRefreshAt: Double = 1_000_000) -> Freshness {
        Freshness(live: live, lastRefreshAt: lastRefreshAt)
    }

    // MARK: freshness
    func testFreshnessNeverHeardNotLive() {
        XCTAssertFalse(Zen.freshness(lastWsMessageAt: 0, now: NOW).live)
    }
    func testFreshnessWithinWindowLive() {
        XCTAssertTrue(Zen.freshness(lastWsMessageAt: NOW - 1000, now: NOW).live)
    }
    func testFreshnessBoundaryStillLive() {
        XCTAssertTrue(Zen.freshness(lastWsMessageAt: NOW - GONE, now: NOW).live)
    }
    func testFreshnessPastWindowNotLive() {
        XCTAssertFalse(Zen.freshness(lastWsMessageAt: NOW - GONE - 1, now: NOW).live)
    }

    // MARK: verdict — dead-man's switch first
    func testDeadManBeatsEscalations() {
        let v = Zen.verdict(openEscalations: [esc("e1"), esc("e2")], sessionSummaries: [:],
                            freshness: fresh(live: false), now: NOW)
        XCTAssertEqual(v.tone, .disconnected)
        XCTAssertTrue(v.line.contains("NOT UPDATING"))
    }
    func testStaleNeverHeardSuffix() {
        let v = Zen.verdict(openEscalations: [], sessionSummaries: [:],
                            freshness: fresh(live: false, lastRefreshAt: 0), now: NOW)
        XCTAssertEqual(v.tone, .disconnected)
        XCTAssertEqual(v.line, "NOT UPDATING — reconnecting…")
    }

    // MARK: verdict — clear / decisions
    func testAllClear() {
        let v = Zen.verdict(openEscalations: [], sessionSummaries: [:], freshness: fresh(), now: NOW)
        XCTAssertEqual(v.tone, .clear)
        XCTAssertEqual(v.line, "All clear")
    }
    func testActiveSessionDoesNotDisturbClear() {
        let v = Zen.verdict(openEscalations: [], sessionSummaries: byKey(summ("a", .active)),
                            freshness: fresh(), now: NOW)
        XCTAssertEqual(v.tone, .clear)
    }
    func testOneDecisionSingular() {
        let v = Zen.verdict(openEscalations: [esc("e1")], sessionSummaries: [:], freshness: fresh(), now: NOW)
        XCTAssertEqual(v.tone, .urgent)
        XCTAssertEqual(v.line, "1 decision waiting")
    }
    func testManyDecisionsPlural() {
        let v = Zen.verdict(openEscalations: [esc("e1"), esc("e2"), esc("e3")], sessionSummaries: [:],
                            freshness: fresh(), now: NOW)
        XCTAssertEqual(v.tone, .urgent)
        XCTAssertEqual(v.line, "3 decisions waiting")
    }

    // MARK: verdict — the regressions (web 899f33a7 / 416e00bb)
    func testWedgedNeverGreen() {
        let v = Zen.verdict(openEscalations: [], sessionSummaries: byKey(summ("w", .wedged)),
                            freshness: fresh(), now: NOW)
        XCTAssertEqual(v.tone, .urgent)
        XCTAssertEqual(v.line, "1 session stuck")
    }
    func testWedgePlusDecisionsCompose() {
        let v = Zen.verdict(openEscalations: [esc("e1"), esc("e2")],
                            sessionSummaries: byKey(summ("w", .wedged)), freshness: fresh(), now: NOW)
        XCTAssertEqual(v.tone, .urgent)
        XCTAssertEqual(v.line, "1 session stuck · 2 decisions waiting")
    }
    func testUnknownOnlyAmber() {
        let v = Zen.verdict(openEscalations: [], sessionSummaries: byKey(summ("u", .unknown)),
                            freshness: fresh(), now: NOW)
        XCTAssertEqual(v.tone, .attention)
        XCTAssertEqual(v.line, "1 session unknown")
    }
    func testDecisionOutranksUnknown() {
        let v = Zen.verdict(openEscalations: [esc("e1")], sessionSummaries: byKey(summ("u", .unknown)),
                            freshness: fresh(), now: NOW)
        XCTAssertEqual(v.tone, .urgent)
        XCTAssertEqual(v.line, "1 decision waiting · 1 session unknown")
    }

    // MARK: triage stack ordering
    func testWedgeOutranksRoutineDecision() {
        let stack = Zen.triageStack(
            openEscalations: [esc("routine")],
            sessionSummaries: byKey(summ("w", .wedged, paneSeenAt: 500)),
            now: NOW)
        XCTAssertEqual(stack.count, 2)
        // wedge (sev 3) before routine escalation (sev 2)
        if case .wedge = stack[0] {} else { XCTFail("expected wedge on top, got \(stack[0])") }
    }
    func testSnoozedSessionExcluded() {
        let stack = Zen.triageStack(
            openEscalations: [],
            sessionSummaries: byKey(summ("w", .wedged, snoozedUntil: NOW + 10_000)),
            now: NOW)
        XCTAssertTrue(stack.isEmpty)
    }
    func testClearedEscalationExcluded() {
        let stack = Zen.triageStack(
            openEscalations: [esc("e1")], sessionSummaries: [:], now: NOW,
            opts: .init(clearedIds: ["e1"]))
        XCTAssertTrue(stack.isEmpty)
    }
    func testOnlyYouPromotesUnknown() {
        let stack = Zen.triageStack(
            openEscalations: [],
            sessionSummaries: byKey(summ("u", .unknown)),
            now: NOW, opts: .init(onlyYouIds: ["unknown:p::u"]))
        XCTAssertEqual(stack.first?.severity, Zen.sevGatedOrWedged)
    }

    // MARK: paragraph stack
    func testParagraphStackRecencyAndCap() {
        let ss = byKey(
            summ("a", .active, paneSeenAt: 10),
            summ("b", .active, summaryUpdatedAt: 50),
            summ("c", .quiet, updatedAt: 30),
            summ("d", .active, paneSeenAt: 5),
            summ("e", .active, paneSeenAt: 40),
            summ("f", .active, paneSeenAt: 1)
        )
        let stack = Zen.paragraphStack(sessionSummaries: ss, cap: 5)
        XCTAssertEqual(stack.count, 5) // capped
        XCTAssertEqual(stack.first?.session, "b") // highest recency (50)
        XCTAssertFalse(stack.contains { $0.session == "f" }) // lowest recency dropped
    }
}
