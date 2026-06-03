/**
 * StudioTicker — the collapsed, single-session EventStream pinned into the
 * Studio rail (Control-UI vision §6). It is the cheap liveness proof: one line,
 * scoped to the current session, fed by the same ring buffer the Bridge stream
 * reads. Renders nothing when there is no session in scope.
 */

import React from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useEventStreamStore } from '@/stores/eventStreamStore';
import { EventStream } from './EventStream';

export const StudioTicker: React.FC = () => {
  const currentSession = useSessionStore((s) => s.currentSession);
  const events = useEventStreamStore((s) => s.events);

  if (!currentSession) return null;

  return (
    <div
      data-testid="studio-ticker"
      className="shrink-0 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
    >
      <EventStream events={events} filterSession={currentSession.name} collapsed />
    </div>
  );
};

export default StudioTicker;
