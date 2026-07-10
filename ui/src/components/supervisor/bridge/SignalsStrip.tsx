/**
 * SignalsStrip — full-width zero-height strip that hosts the two human-gated
 * banners: DeployBanner (sidecar staleness) and RequirementsInbox (promise
 * awaiting signature). Renders with zero height when both are empty; preserves
 * the banner's polling so it can report the moment a stale sidecar appears.
 *
 * Decision D5 (bridge-option-c-final-design): no feature is deleted by omission.
 * The strip adds NO affordance that sets a criterion verdict or advances a mission phase.
 */

import React, { useState } from 'react';
import type { Requirement } from '@/stores/supervisorStore';
import { selectInboxRequirements } from './requirementSelectors';
import { DeployBanner } from './DeployBanner';
import { RequirementsInbox } from './RequirementsInbox';

export interface SignalsStripProps {
  requirements: Requirement[];
  project: string;
  serverScope: string;
}

export const SignalsStrip: React.FC<SignalsStripProps> = ({
  requirements,
  project,
  serverScope,
}) => {
  const [deployVisible, setDeployVisible] = useState(false);

  const inboxCount = selectInboxRequirements(requirements, project).length;
  const anySignal = deployVisible || inboxCount > 0;

  const banner = (
    <DeployBanner
      project={project}
      serverScope={serverScope}
      onVisibleChange={setDeployVisible}
    />
  );

  if (!anySignal) {
    return (
      <div hidden data-testid="signals-strip-idle">
        {banner}
      </div>
    );
  }

  return (
    <div
      data-testid="signals-strip"
      className="w-full shrink-0 flex flex-col gap-2 px-3 py-2"
    >
      {banner}
      <RequirementsInbox
        requirements={requirements}
        project={project}
        serverScope={serverScope}
      />
    </div>
  );
};

export default SignalsStrip;
