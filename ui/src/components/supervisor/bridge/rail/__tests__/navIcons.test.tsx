import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CampaignIcon, MissionIcon } from '../navIcons';
import { BridgeRail } from '../BridgeRail';

describe('navIcons', () => {
  it('CampaignIcon renders an element with testid campaign-nav-icon', () => {
    render(<CampaignIcon />);
    expect(screen.getByTestId('campaign-nav-icon')).toBeInTheDocument();
  });

  it('MissionIcon renders an element with testid mission-nav-icon', () => {
    render(<MissionIcon />);
    expect(screen.getByTestId('mission-nav-icon')).toBeInTheDocument();
  });

  it('BridgeRail renders exactly one campaign-nav-icon inside bridge-link-campaigns', () => {
    render(<BridgeRail />);
    const button = screen.getByTestId('bridge-link-campaigns');
    expect(within(button).getAllByTestId('campaign-nav-icon')).toHaveLength(1);
  });

  it('BridgeRail renders exactly one mission-nav-icon inside bridge-link-missions', () => {
    render(<BridgeRail />);
    const button = screen.getByTestId('bridge-link-missions');
    expect(within(button).getAllByTestId('mission-nav-icon')).toHaveLength(1);
  });
});
