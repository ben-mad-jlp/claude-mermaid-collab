/**
 * AlertRibbon — thin banner-tier alert strip across the top of the Bridge
 * (Control-UI vision §4). Derives its alerts from store selectors passed in by
 * BridgeDashboard; renders nothing when there is nothing loud to say.
 */

import React from 'react';

export interface AlertItem {
  id: string;
  text: string;
  tone: 'danger' | 'warning';
}

export interface AlertRibbonProps {
  alerts: AlertItem[];
}

export const AlertRibbon: React.FC<AlertRibbonProps> = ({ alerts }) => {
  if (alerts.length === 0) return null;

  return (
    <div
      data-testid="alert-ribbon"
      className="shrink-0 flex items-center gap-3 flex-wrap px-3 py-1 bg-danger-500 text-white text-2xs font-medium"
    >
      {alerts.map((a) => (
        <span key={a.id} className={a.tone === 'warning' ? 'opacity-90' : ''}>
          {a.text}
        </span>
      ))}
    </div>
  );
};
