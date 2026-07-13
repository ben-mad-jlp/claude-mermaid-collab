import SwiftUI

enum Space {
    static let xs: CGFloat = 4
    static let s: CGFloat = 8
    static let m: CGFloat = 12
    static let l: CGFloat = 16
    static let xl: CGFloat = 24
}

enum ZenStatus {
    case working, needsYou, stuck, stalled, idle, unknown

    var accent: Color {
        switch self {
        case .working: return .green
        case .needsYou: return .orange
        case .stuck: return .red
        case .stalled: return .yellow
        case .idle, .unknown: return .secondary
        }
    }

    var symbol: String {
        switch self {
        case .working: return "arrow.triangle.2.circlepath"
        case .needsYou: return "questionmark.bubble.fill"
        case .stuck: return "exclamationmark.triangle.fill"
        case .stalled: return "pause.circle.fill"
        case .idle: return "moon.zzz"
        case .unknown: return "circle.dotted"
        }
    }

    var label: String {
        switch self {
        case .working: return "working"
        case .needsYou: return "needs you"
        case .stuck: return "stuck"
        case .stalled: return "stalling"
        case .idle: return "idle"
        case .unknown: return "unknown"
        }
    }

    init(statusKey: String) {
        switch statusKey {
        case "working", "active": self = .working
        case "needs-input", "asking": self = .needsYou
        case "stuck", "wedged": self = .stuck
        case "stalled": self = .stalled
        default: self = .idle
        }
    }
}

struct CardStyle: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.regularMaterial)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color(.separator).opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(scheme == .dark ? 0 : 0.06), radius: 8, y: 2)
    }
}

extension View {
    func zenCard() -> some View { modifier(CardStyle()) }
}

extension Font {
    static var zenGlance: Font { .title3.weight(.medium) }
    static var zenSessionName: Font { .subheadline.weight(.semibold) }
    static var zenProjectEyebrow: Font { .caption.weight(.semibold) }
    static var zenMeta: Font { .caption2.weight(.medium) }
}
