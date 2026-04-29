import React from 'react';

export interface SidebarHeaderProps {
  connected: boolean;
  isConnecting: boolean;
}

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({ connected, isConnecting }) => {
  const pillClass = isConnecting
    ? 'bg-yellow-100 text-yellow-700'
    : connected
    ? 'bg-green-100 text-green-700'
    : 'bg-red-100 text-red-700';

  const dotClass = isConnecting
    ? 'bg-yellow-500 animate-pulse'
    : connected
    ? 'bg-green-500'
    : 'bg-red-500';

  const label = isConnecting ? 'Connecting' : connected ? 'Connected' : 'Disconnected';

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b">
      {/* CollabLogo inline SVG ~16px */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M5 8h6M8 5v6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="font-semibold text-sm">Collab</span>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${pillClass}`}>
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        {label}
      </span>
    </div>
  );
};

export default SidebarHeader;
