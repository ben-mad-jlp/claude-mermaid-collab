import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BridgeRail } from '../rail/BridgeRail';

describe('BridgeRail navigation order', () => {
  it('the campaign link renders above the missions link', () => {
    render(
      <BridgeRail
        onOpenCampaigns={vi.fn()}
        onOpenMissions={vi.fn()}
      />
    );

    const campaigns = screen.getByTestId('bridge-link-campaigns');
    const missions = screen.getByTestId('bridge-link-missions');

    const position = campaigns.compareDocumentPosition(missions);
    expect((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  it('the missions link renders above the plan section', () => {
    render(
      <BridgeRail
        onOpenCampaigns={vi.fn()}
        onOpenMissions={vi.fn()}
      />
    );

    const missions = screen.getByTestId('bridge-link-missions');
    const planSection = screen.getByTestId('rail-section-home');

    const position = missions.compareDocumentPosition(planSection);
    expect((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  it('the missions link opens the missions view', () => {
    const onOpenMissions = vi.fn();
    render(
      <BridgeRail
        onOpenCampaigns={vi.fn()}
        onOpenMissions={onOpenMissions}
      />
    );

    const missions = screen.getByTestId('bridge-link-missions');
    fireEvent.click(missions);

    expect(onOpenMissions).toHaveBeenCalledTimes(1);
  });
});
