# Wave 4 Implementation

All new files under `ui/src/components/supervisor/`.

## Tasks
- **escalation-inbox** (`EscalationInbox.tsx`): props {serverId, onJump?}; reads store escalations; open/resolved toggle + kind filter; kind glyphs; relative time; Jump + Resolve buttons; empty states.
- **roadmap-panel** (`RoadmapPanel.tsx`): props {serverId, project}; Graph/Waves/List toggle; list mode with status glyphs; graph/waves feed `roadmapToMermaid(items,{mode})` into **MermaidPreview** (real renderer at ui/src/components/editors/MermaidPreview.tsx — not a fallback); counts footer.
- **supervised-region** (`SupervisedSessions.tsx`): props {serverId, onJump?}; grouped by project; source tag; roadmap link via sessionName match; nudge / open / stop (optimistic setSupervisedLocal + DELETE + reload).
- **onboarding** (`SupervisorOnboarding.tsx`): props {serverId, state:'none'|'crashed', lastSession?, onStarted?}; reads/saves config; will/won't list; Start/Restart → saveConfig then POST /api/ide/launch-session (mc.invokeOnServer or fetch).

## Verification
- All four agents report tsc-clean; wave-level UI `tsc -p tsconfig.json` clean; root tsc clean.

## Wave TSC
clean.

## Note for Wave 5 (shell)
Shell must wire: onJump handler (select session + terminal/browser side-effects like SupervisorPanel.handleNavigate/activateSessionCard), pass serverId/project, and choose onboarding state ('none'/'crashed'/running) from a supervisor-status check.
