import Foundation
import SwiftUI

// Wire model + pure card helpers for the Zen iOS app. Mirrors the desktop
// ZenSessionCard: the server's `session_summary_updated` WS payload + the glance/detail/
// status/freshness derivations. Kept self-contained so the app builds standalone.

struct ZenStructured: Codable, Equatable {
    let paragraph: String
    let detail: String?
    let status: String
    let question: String?
    let options: [ZenOption]?
    let recommended: Int?
}

struct ZenOption: Codable, Equatable {
    let label: String
    let valueToSend: String
}

/// A structured escalation option (decide path): server-side id + label.
struct EscOption: Codable, Equatable, Identifiable {
    let id: String
    let label: String
    let detail: String?
}

/// An open escalation needing a human decision (from /api/supervisor/escalations + the
/// `escalation_created` WS broadcast). Answered via POST …/decide { optionId }.
struct Escalation: Codable, Equatable, Identifiable {
    let id: String
    let project: String
    let session: String
    let questionText: String
    let status: String?
    let options: [EscOption]?
    let recommended: String?  // option id the worker recommends
    var key: String { "\(project)::\(session)" }
}

/// Wrapper for GET /api/supervisor/escalations.
struct EscalationsResponse: Codable { let escalations: [Escalation] }

/// The `escalation_created` WS message carries the full escalation under `escalation`.
struct EscalationCreatedMsg: Codable {
    let type: String
    let escalation: Escalation?
}
/// The `escalation_decided` / resolve WS messages identify the escalation by id.
struct EscalationGoneMsg: Codable {
    let type: String
    let id: String?
}

// MARK: Mission drill-in (GET /api/supervisor/missions)
// Mirrors src/services/mission-store.ts MissionSummary. Read-only. Extra JSON
// fields are ignored by Codable — decode only what the drill-in view reads.

struct MissionsResponse: Codable { let missions: [MissionSummary] }

struct MissionSummary: Codable, Identifiable {
    let node: MissionNode
    let ownerSession: String?
    let assigneeSession: String?
    let mission: MissionRow
    let rollup: MissionRollup
    let criteria: [MissionCriterion]
    let epics: [MissionEpic]

    var id: String { node.id }
}

struct MissionNode: Codable { let id: String; let title: String; let status: String }

struct MissionRow: Codable { let active: Bool; let status: String? }

struct MissionRollup: Codable {
    let mechanical: GaugeDone
    let capability: GaugeMet
    let converged: Bool
    let stopped: Bool
    let status: String
}

struct GaugeDone: Codable { let done: Int; let total: Int }
struct GaugeMet: Codable { let met: Int; let total: Int }

struct MissionCriterion: Codable, Identifiable {
    let id: String
    let text: String
    let met: Bool
    let evidence: String?
    let verifiedBy: String?
}

struct MissionEpic: Codable, Identifiable {
    let id: String
    let title: String
    let status: String
    let acceptanceStatus: String?
}

/// One `session_summary_updated` message (also the hydrate snapshot shape).
struct ZenSummary: Codable, Equatable, Identifiable {
    let type: String
    let project: String
    let session: String
    let progressState: String?
    let paneSeenAt: Double?
    let updatedAt: Double?
    let summaryText: String?
    let summaryUpdatedAt: Double?
    let structured: ZenStructured?

    var id: String { "\(project)::\(session)" }
    var projectName: String { project.split(separator: "/").last.map(String.init) ?? project }
    var sessionName: String { session.split(separator: "/").last.map(String.init) ?? session }
    var paragraph: String { (structured?.paragraph ?? summaryText ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
    var detail: String { (structured?.detail ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }

    /// First two whole sentences of the paragraph (the glance), no mid-word cutoff.
    var glance: String {
        let p = paragraph
        if p.isEmpty { return "" }
        var sentences: [String] = []
        var cur = ""
        for ch in p {
            cur.append(ch)
            if ch == "." || ch == "!" || ch == "?" {
                let t = cur.trimmingCharacters(in: .whitespaces)
                if !t.isEmpty { sentences.append(t) }
                cur = ""
            }
        }
        let tail = cur.trimmingCharacters(in: .whitespaces)
        if !tail.isEmpty { sentences.append(tail) }
        if sentences.isEmpty { return p }
        return sentences.prefix(2).joined(separator: " ")
    }

    /// The larger summary revealed on tap — the richer `detail`, else the full paragraph.
    var expanded: String { detail.isEmpty ? paragraph : detail }
    var hasMore: Bool { expanded.count > glance.count }

    /// Interpreter status, else structural progressState, → a dot color + label.
    var statusKey: String { structured?.status ?? progressState ?? "unknown" }
    var statusColor: Color {
        switch statusKey {
        case "working", "active": return .green
        case "stuck", "wedged": return .red
        case "stalled": return .orange
        case "needs-input": return .orange
        default: return .gray
        }
    }
    var statusLabel: String {
        switch statusKey {
        case "working", "active": return "working"
        case "stuck", "wedged": return "stuck"
        case "stalled": return "stalling"
        case "needs-input": return "needs you"
        case "idle", "quiet": return "idle"
        default: return "unknown"
        }
    }

    var hasQuestion: Bool {
        let s = structured
        let opts = (s?.options?.count ?? 0) > 0
        return s?.status == "needs-input" && (opts || (s?.question?.isEmpty == false))
    }

    /// Recency-tint opacity (0…0.14), full ≤2min, fading to 0 at 20min — mirrors the web wash.
    func freshnessOpacity(now: Double) -> Double {
        guard let ts = summaryUpdatedAt, ts > 0 else { return 0 }
        let age = now - ts
        let full = 2.0 * 60_000, fade = 20.0 * 60_000
        if age >= fade { return 0 }
        let t = max(0, min(1, (fade - age) / (fade - full)))
        return t * 0.14
    }

    /// Ordering rank: needs-you → stuck → active → rest.
    var rank: Int {
        if hasQuestion { return 0 }
        switch statusKey {
        case "stuck", "wedged", "stalled": return 1
        case "working", "active": return 2
        default: return 3
        }
    }
    var recency: Double { max(summaryUpdatedAt ?? 0, paneSeenAt ?? 0, updatedAt ?? 0) }
}
