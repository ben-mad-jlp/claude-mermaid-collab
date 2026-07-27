import React from 'react';
import type { CoverageRollup } from '@/stores/supervisorStore';
import { SpecCoverageCard } from '../SpecCoverageCard';
import type { RailKey } from './RailNav';

export interface ProjectFooterProps {
  coverage?: CoverageRollup;
  onSelectPanel?: (key: RailKey) => void;
}

export const ProjectFooter: React.FC<ProjectFooterProps> = ({ coverage }) => {
  const showCoverage = !!coverage && coverage.total > 0;

  if (!showCoverage) return null;

  return (
    <div data-testid="project-footer" className="space-y-3 p-2">
      <SpecCoverageCard coverage={coverage} />
    </div>
  );
};

export default ProjectFooter;
