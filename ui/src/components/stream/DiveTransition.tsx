/**
 * DiveTransition — the ~200ms morph behind a dive (Control-UI vision §5,
 * §7 phase 6).
 *
 * When a Bridge card dives into Studio, the mode swap unmounts the card and
 * mounts the Studio cockpit frame. We give the cockpit frame a short
 * grow-in animation (`animate-dive-in`, see index.css) so it reads as the card
 * expanding into the cockpit rather than a hard cut; step-back is the plain
 * reverse cut. This is intentionally dependency-free CSS — no animation library
 * is pulled in (which would perturb unrelated type resolution).
 *
 * `DiveLayoutGroup` stays as a structural wrapper so call sites read the same
 * regardless of the underlying animation mechanism, and `diveLayoutId` yields a
 * stable per-session token usable as a data attribute / future
 * view-transition-name.
 */

import React from 'react';

/** Stable shared-element token for a session's card ⇄ cockpit pair. */
export function diveLayoutId(session: string | undefined | null): string | undefined {
  return session ? `dive-frame-${session}` : undefined;
}

/** Structural passthrough — the morph itself is CSS on the cockpit frame. */
export const DiveLayoutGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>{children}</>
);

export default DiveLayoutGroup;
