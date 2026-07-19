/**
 * instance_topology — read-only map of every live mermaid-collab server this
 * machine knows about, with each one tagged CANONICAL vs STALE SHADOW.
 *
 * The footgun this addresses: a deploy "goes cosmetic" because a stale source
 * server (e.g. a plugin SessionStart hook's `bun run src/server.ts`) is shadowing
 * the desktop app's sidecar on the canonical :9002 — the swap lands in a process
 * nobody is talking to (memory `project_plugin_hook_shadows_server`). Until now
 * you had to spelunk `~/.mermaid-collab/instances`, the ownership lockfile, and
 * `lsof` by hand to see it. This tool joins all three:
 *
 *   1. The on-disk instance records (`readInstances`) — every server that
 *      registered itself: port, project/session, pid, version, startedAt.
 *   2. The canonical :9002 ownership lockfile (`readLock`) + a live `/api/health`
 *      probe of the port — together these identify the ONE process that actually
 *      won the bind handshake and owns the canonical port right now.
 *   3. The in-memory peer registry (`listPeers`) — remote peer servers online.
 *
 * Tagging rule (the whole point): among the instances claiming the canonical
 * port, the one whose pid is the live :9002 holder (or, absent a live probe, the
 * lockfile owner) is `canonical`; every OTHER instance claiming that port is a
 * `shadow`. Instances on their own non-canonical port are plain `instance`. If
 * two servers contend :9002 and we can't tell which is live, they're ALL flagged
 * `shadow` (ambiguous-but-contending) rather than silently picking one — better a
 * visible "something is shadowing" than a false all-clear.
 *
 * The classifier (`classifyInstances`) is a PURE function over already-fetched
 * inputs so it is trivially unit-testable; `instanceTopology` is the thin
 * discovery/lock/health-probe-backed wrapper the MCP tool calls.
 */
import {
  readInstances,
  type Instance,
  type DiscoveryPaths,
  getDiscoveryPaths,
} from './instance-discovery';
import {
  readLock,
  readHealthIdentity,
  type LockData,
  type ServerIdentity,
} from './port-ownership';
import { listPeers, type PeerInfo } from './supervisor-store';
import { DEFAULT_MERMAID_PORT } from './config-file';

/** The canonical port the desktop app's sidecar is supposed to own. */
export const CANONICAL_PORT = DEFAULT_MERMAID_PORT;

/** How a single instance relates to the canonical port. */
export type InstanceTag =
  /** This instance is the live owner of the canonical port — the real server. */
  | 'canonical'
  /** This instance claims the canonical port but is NOT its live owner — a stale shadow. */
  | 'shadow'
  /** A normal server on its own (non-canonical) port — not contending :9002. */
  | 'instance';

export interface TaggedInstance {
  sessionId: string;
  port: number;
  project: string;
  session: string;
  pid: number;
  serverVersion: string;
  startedAt: string;
  tag: InstanceTag;
  /** Whether the pid is still alive (signal-0 probe). */
  alive: boolean;
  /** Human-readable reason for the tag. */
  reason: string;
}

export interface RemotePeer {
  serverId: string;
  baseUrl: string;
}

/** Identity of the live process actually answering on the canonical port, if any. */
export interface CanonicalHolder {
  pid: number;
  version: string;
  exePath: string;
  owner: string;
  startedAt: string;
}

export interface InstanceTopology {
  canonicalPort: number;
  /** The live :9002 holder from /api/health, or null if nothing answered. */
  canonicalHolder: CanonicalHolder | null;
  /** The ownership lockfile record for the canonical port, or null. */
  lock: { pid: number; exePath: string; version: string; port: number; owner: string } | null;
  /** Every registered local instance, canonical/shadow/instance-tagged. */
  instances: TaggedInstance[];
  /** Remote peer servers online (from the in-memory peer registry). */
  peers: RemotePeer[];
  /** True when ≥1 instance is tagged `shadow` — the deploy-went-cosmetic warning. */
  hasShadow: boolean;
}

/** Probe whether a pid is alive (signal 0). Injectable for tests. */
function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pure classifier — tags already-fetched instances against the known canonical
 * owner. `canonicalPid` is the pid that actually owns the canonical port (the
 * live :9002 health holder, falling back to the lockfile owner), or null if
 * neither is known. No I/O, so unit tests feed hand-built instances + a pid.
 */
export function classifyInstances(
  instances: Instance[],
  canonicalPort: number,
  canonicalPid: number | null,
  pidAlive: (pid: number) => boolean = defaultPidAlive,
): TaggedInstance[] {
  const onCanonical = instances.filter((i) => i.port === canonicalPort);
  // When we have no authoritative owner but exactly ONE live server claims the
  // canonical port, that one is canonical by elimination. Otherwise (zero, or
  // ≥2 contenders we can't disambiguate) leave canonicalPid null → contenders
  // are all flagged shadow rather than guessing.
  let effectiveCanonicalPid = canonicalPid;
  if (effectiveCanonicalPid == null) {
    const liveOnCanonical = onCanonical.filter((i) => pidAlive(i.pid));
    if (liveOnCanonical.length === 1) effectiveCanonicalPid = liveOnCanonical[0].pid;
  }

  return instances.map((i) => {
    const alive = pidAlive(i.pid);
    let tag: InstanceTag;
    let reason: string;
    if (i.port !== canonicalPort) {
      tag = 'instance';
      reason = `server on its own port :${i.port} (not contending the canonical :${canonicalPort})`;
    } else if (effectiveCanonicalPid != null && i.pid === effectiveCanonicalPid) {
      tag = 'canonical';
      reason = `live owner of the canonical port :${canonicalPort}`;
    } else {
      tag = 'shadow';
      reason =
        effectiveCanonicalPid != null
          ? `claims the canonical port :${canonicalPort} but pid ${i.pid} is not its live owner (pid ${effectiveCanonicalPid}) — stale shadow`
          : `claims the canonical port :${canonicalPort} but its live owner is undetermined — contending shadow`;
    }
    return {
      sessionId: i.sessionId,
      port: i.port,
      project: i.project,
      session: i.session,
      pid: i.pid,
      serverVersion: i.serverVersion,
      startedAt: i.startedAt,
      tag,
      alive,
      reason,
    };
  });
}

export interface InstanceTopologyDeps {
  paths?: DiscoveryPaths;
  /** Read the on-disk instance records. Injectable for tests. */
  readInstancesImpl?: (paths: DiscoveryPaths) => Promise<Instance[]>;
  /** Read the live canonical-port health identity. Injectable for tests. */
  readHealth?: (port: number) => Promise<ServerIdentity | null>;
  /** Read the canonical ownership lockfile. Injectable for tests. */
  readLockImpl?: () => LockData | null;
  /** List remote peers. Injectable for tests. */
  listPeersImpl?: () => PeerInfo[];
  pidAlive?: (pid: number) => boolean;
}

/**
 * Discovery/lock/health-backed wrapper the MCP tool calls. Reads the on-disk
 * instance records, the canonical ownership lockfile, a live :9002 health probe,
 * and the peer registry, then delegates to the pure {@link classifyInstances}.
 */
export async function instanceTopology(deps: InstanceTopologyDeps = {}): Promise<InstanceTopology> {
  const paths = deps.paths ?? getDiscoveryPaths();
  const readInstancesFn = deps.readInstancesImpl ?? readInstances;
  const readHealth = deps.readHealth ?? ((port: number) => readHealthIdentity(port));
  const readLockFn = deps.readLockImpl ?? (() => readLock());
  const listPeersFn = deps.listPeersImpl ?? listPeers;
  const pidAlive = deps.pidAlive ?? defaultPidAlive;

  const instances = await readInstancesFn(paths);
  const lock = readLockFn();
  const health = await readHealth(CANONICAL_PORT);

  // Authoritative canonical pid: the live :9002 holder if it answered, else the
  // lockfile owner (only if still alive — a stale lock pid isn't the owner).
  let canonicalPid: number | null = null;
  if (health) canonicalPid = health.pid;
  else if (lock && pidAlive(lock.pid) && lock.port === CANONICAL_PORT) canonicalPid = lock.pid;

  const tagged = classifyInstances(instances, CANONICAL_PORT, canonicalPid, pidAlive);

  const canonicalHolder: CanonicalHolder | null = health
    ? {
        pid: health.pid,
        version: health.version,
        exePath: health.exePath,
        owner: health.owner,
        startedAt: health.startedAt,
      }
    : null;

  const peers: RemotePeer[] = listPeersFn().map((p) => ({
    serverId: p.serverId,
    baseUrl: p.baseUrl,
  }));

  return {
    canonicalPort: CANONICAL_PORT,
    canonicalHolder,
    lock: lock
      ? { pid: lock.pid, exePath: lock.exePath, version: lock.version, port: lock.port, owner: lock.owner }
      : null,
    instances: tagged,
    peers,
    hasShadow: tagged.some((i) => i.tag === 'shadow'),
  };
}
