import React from 'react';

export interface TurnRailTurn {
  id: string;
  label?: string;
}

export interface TurnRailProps {
  turns: Array<TurnRailTurn>;
  activeTurnId?: string;
  onJump: (id: string) => void;
}

/**
 * Left rail with vertical turn anchors. Click a dot to jump to the turn.
 * Sticky position so it stays visible while scrolling.
 */
export const TurnRail: React.FC<TurnRailProps> = ({ turns, activeTurnId, onJump }) => {
  return (
    <nav
      aria-label="Turn rail"
      className="sticky top-0 flex flex-col items-center gap-2 py-2 px-1 self-start"
    >
      {turns.map((turn) => {
        const isActive = turn.id === activeTurnId;
        const label = turn.label ?? `Turn ${turn.id}`;
        return (
          <button
            key={turn.id}
            type="button"
            aria-label={label}
            aria-current={isActive ? 'true' : undefined}
            data-turn-id={turn.id}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => onJump(turn.id)}
            className={
              'w-3 h-3 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ' +
              (isActive
                ? 'bg-blue-600 dark:bg-blue-400 ring-2 ring-blue-300 dark:ring-blue-700'
                : 'bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500')
            }
          />
        );
      })}
    </nav>
  );
};

export default TurnRail;
