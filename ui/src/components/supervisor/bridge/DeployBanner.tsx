/**
 * DeployBanner — the single surface for the human-gated self-deploy
 * (land-deploy-hook-design). Self-hides unless the running :9002 sidecar is
 * STALE against its repo: either version-string drift OR a self-project epic
 * that landed AFTER the running binary started (the precise signal the version
 * check misses). Deploy is STRICTLY SEPARATE from land — this is the only place
 * it lives, and it offers the button only when the server says `canDeploy`.
 *
 * The deploy kills+relaunches the sidecar, so after firing we flip to a
 * "deploying…" state and poll deploy-status until a NEW liveStartedAt answers —
 * that reconnection IS the success signal.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSupervisorStore, type DeployStatus } from '../../../stores/supervisorStore';

interface DeployBannerProps {
  project: string;
  serverScope: string;
  onVisibleChange?: (visible: boolean) => void;
}

const POLL_MS = 8000;

export const DeployBanner: React.FC<DeployBannerProps> = ({ project, serverScope, onVisibleChange }) => {
  const fetchDeployStatus = useSupervisorStore((s) => s.fetchDeployStatus);
  const deploySelf = useSupervisorStore((s) => s.deploySelf);

  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The liveStartedAt at the moment we fired a deploy — when a poll returns a
  // DIFFERENT one, the new sidecar is up and the deploy succeeded.
  const deployingFromRef = useRef<string | null>(null);

  const visible = !!status && (status.stale || deploying);
  useEffect(() => { onVisibleChange?.(visible); }, [visible, onVisibleChange]);

  const poll = useCallback(async () => {
    if (!project) return;
    try {
      const next = await fetchDeployStatus(serverScope, project);
      if (next) {
        setStatus(next);
        if (deployingFromRef.current != null && next.liveStartedAt && next.liveStartedAt !== deployingFromRef.current) {
          // New sidecar answered — deploy landed.
          setDeploying(false);
          deployingFromRef.current = null;
        }
      }
    } catch {
      /* transient — the sidecar may be mid-restart; next tick recovers */
    }
  }, [fetchDeployStatus, serverScope, project]);

  useEffect(() => {
    void poll();
    const id = setInterval(() => { void poll(); }, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const onDeploy = useCallback(async (force = false) => {
    setError(null);
    deployingFromRef.current = status?.liveStartedAt ?? null;
    setDeploying(true);
    const res = await deploySelf(serverScope, project, force);
    if (!res.started) {
      setDeploying(false);
      deployingFromRef.current = null;
      // A deploy hard-kills the sidecar; refuse while a leaf is mid-flight unless
      // the human confirms the in-flight work will be lost (re-runs from scratch).
      if (res.reason === 'leaves-in-flight') {
        const n = res.inflightLeaves?.length ?? 0;
        if (
          window.confirm(
            `${n} leaf${n === 1 ? ' is' : 'es are'} still building. Deploying now hard-kills the worker and the in-flight work is lost (it re-runs from scratch on the next claim).\n\nDeploy anyway?`,
          )
        ) {
          void onDeploy(true);
        }
        return;
      }
      setError(`Deploy not started: ${res.reason}`);
    }
    // On success the sidecar restarts; poll() detects the new liveStartedAt.
  }, [deploySelf, serverScope, project, status?.liveStartedAt]);

  // Self-hide unless stale (or actively deploying, so the progress stays visible).
  if (!visible || !status) return null;

  const reason = status.selfLandPending
    ? 'an epic landed after this build started'
    : status.versionDrift
      ? `live v${status.liveVersion ?? '?'} vs repo v${status.repoVersion ?? '?'}`
      : status.modifiedTrackedCount > 0
        ? `${status.modifiedTrackedCount} uncommitted change${status.modifiedTrackedCount === 1 ? '' : 's'} in the repo`
        : 'the running build differs from the repo';

  return (
    <div
      data-testid="deploy-banner"
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden className="text-amber-600 dark:text-amber-400">🚀</span>
        <div className="min-w-0">
          <div className="font-semibold text-amber-800 dark:text-amber-200">
            {deploying ? 'Deploying… the app will restart' : 'Sidecar is stale'}
          </div>
          <div className="text-amber-700/80 dark:text-amber-300/70 truncate">
            {deploying
              ? 'Waiting for the new build to answer on :9002…'
              : `Live v${status.liveVersion ?? '?'} · repo @${status.repoHead ?? '?'} — ${reason}.`}
          </div>
          {error && <div className="text-danger-600 dark:text-danger-400">{error}</div>}
        </div>
      </div>
      <div className="shrink-0">
        {status.canDeploy ? (
          <button
            type="button"
            data-testid="deploy-banner-button"
            disabled={deploying}
            onClick={() => { void onDeploy(); }}
            className="rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-not-allowed px-3 py-1.5 font-semibold text-white"
          >
            {deploying ? 'Deploying…' : 'Deploy'}
          </button>
        ) : (
          <span className="text-amber-700/70 dark:text-amber-300/60" title={status.deployBlockedReason ?? undefined}>
            {status.deployBlockedReason === 'unsupported-platform'
              ? 'deploy: macOS only'
              : status.deployBlockedReason === 'not-self-project'
                ? 'deploy: self-project only'
                : 'deploy unavailable here'}
          </span>
        )}
      </div>
    </div>
  );
};
