import React from 'react';

interface Props {
  used: number;
  max: number;
}

const ContextMeter: React.FC<Props> = ({ used, max }) => {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.max(0, Math.min(1, used / safeMax));
  const percent = ratio * 100;

  let barColor = 'bg-gray-400 dark:bg-gray-500';
  if (percent >= 95) {
    barColor = 'bg-red-500';
  } else if (percent >= 80) {
    barColor = 'bg-amber-500';
  }

  return (
    <div
      className="w-full"
      role="progressbar"
      aria-valuenow={used}
      aria-valuemin={0}
      aria-valuemax={max}
      data-testid="context-meter"
    >
      <div className="h-2 w-full bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
        <div
          data-testid="context-meter-bar"
          className={`h-full transition-all ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 flex justify-between">
        <span>{used}/{max} tokens</span>
        <span>{Math.round(percent)}%</span>
      </div>
    </div>
  );
};

ContextMeter.displayName = 'ContextMeter';

export default ContextMeter;
