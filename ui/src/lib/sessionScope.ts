import type { Session } from '@/types';

export function reconcileScopeOnSessionSelect(
  session: Session,
  { setCurrentSession, setActiveProject }: {
    setCurrentSession: (session: Session) => void;
    setActiveProject: (project: string | null) => void;
  }
): void {
  setCurrentSession(session);
  setActiveProject(session.project ?? null);
}
