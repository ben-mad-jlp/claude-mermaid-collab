import React from 'react';

export interface NavIconProps {
  className?: string;
}

export const CampaignIcon: React.FC<NavIconProps> = ({ className }) => (
  <span data-testid="campaign-nav-icon" aria-hidden className={className}>◇</span>
);

export const MissionIcon: React.FC<NavIconProps> = ({ className }) => (
  <span data-testid="mission-nav-icon" aria-hidden className={className}>✦</span>
);
