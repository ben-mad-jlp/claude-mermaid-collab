import { readdir, readFile, writeFile, mkdir, access, stat } from 'fs/promises';
import { join } from 'path';

// Word lists for name generation (embedded to avoid cross-dependencies)
const ADJECTIVES = [
  'bold', 'brave', 'bright', 'brisk', 'calm', 'cheerful', 'clean', 'clear', 'clever', 'cool',
  'cozy', 'crisp', 'daring', 'deep', 'eager', 'easy', 'fair', 'fast', 'fine', 'free',
  'fresh', 'friendly', 'gentle', 'glad', 'gleaming', 'glowing', 'golden', 'good', 'grand', 'green',
  'happy', 'hearty', 'honest', 'keen', 'kind', 'light', 'lively', 'lucky', 'merry', 'mild',
  'neat', 'nimble', 'noble', 'open', 'patient', 'peaceful', 'plain', 'pleasant', 'polite', 'proud',
  'pure', 'quick', 'quiet', 'radiant', 'rapid', 'ready', 'rich', 'safe', 'serene', 'sharp',
  'shiny', 'simple', 'smart', 'smooth', 'soft', 'solid', 'sound', 'sparkling', 'speedy', 'splendid',
  'stable', 'steady', 'still', 'strong', 'sunny', 'sure', 'sweet', 'swift', 'tall', 'tender',
  'tidy', 'tranquil', 'true', 'trusty', 'vivid', 'warm', 'welcome', 'wild', 'willing', 'wise',
  'witty', 'worthy', 'young', 'zealous', 'zesty',
];

const NOUNS = [
  'anchor', 'apple', 'arrow', 'badge', 'basket', 'beacon', 'bell', 'bird', 'bloom', 'boat',
  'book', 'branch', 'breeze', 'bridge', 'brook', 'cabin', 'canyon', 'castle', 'cave', 'cedar',
  'cliff', 'cloud', 'coral', 'crane', 'creek', 'crown', 'dawn', 'delta', 'dove', 'dune',
  'eagle', 'elm', 'ember', 'falcon', 'fern', 'field', 'finch', 'flame', 'flower', 'forest',
  'fox', 'garden', 'gate', 'glacier', 'glade', 'grove', 'harbor', 'hawk', 'hearth', 'heron',
  'hill', 'hollow', 'horizon', 'inlet', 'island', 'ivy', 'jade', 'jasper', 'lake', 'lantern',
  'lark', 'leaf', 'lighthouse', 'lily', 'lodge', 'lotus', 'maple', 'marsh', 'meadow', 'mesa',
  'mist', 'moon', 'moss', 'nest', 'oak', 'ocean', 'olive', 'orchid', 'otter', 'owl',
  'palm', 'path', 'peak', 'pearl', 'pebble', 'pine', 'pond', 'prairie', 'quill', 'rain',
  'raven', 'reef', 'ridge', 'river', 'robin', 'rock', 'rose', 'sage', 'sail', 'sand',
  'shore', 'sky', 'spark', 'spring', 'spruce', 'star', 'stone', 'stream', 'summit', 'sun',
  'swan', 'tide', 'trail', 'tree', 'tulip', 'valley', 'wave', 'willow', 'wind', 'wing', 'wren',
];

export type CollabTemplate = 'feature' | 'bugfix' | 'refactor' | 'spike';
export type CollabPhase = 'brainstorming' | 'rough-draft/interface' | 'rough-draft/pseudocode' | 'rough-draft/skeleton' | 'implementation';

export interface CollabMetadata {
  name: string;
  template: CollabTemplate;
  createdAt: string;
  description: string;
}

export interface CollabState {
  phase: CollabPhase;
  template: CollabTemplate;
  lastActivity: string;
  pendingVerificationIssues: VerificationIssue[];
}

export interface VerificationIssue {
  type: string;
  description: string;
  file?: string;
  detectedAt: string;
}

export interface CollabSession {
  name: string;
  template: CollabTemplate;
  phase: CollabPhase;
  lastActivity: string;
  pendingIssueCount: number;
  path: string;
}

/**
 * Get a random element from an array
 */
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a memorable name using adjective-adjective-noun pattern
 */
function generateSessionName(): string {
  const adj1 = randomChoice(ADJECTIVES);
  const adj2 = randomChoice(ADJECTIVES);
  const noun = randomChoice(NOUNS);
  return `${adj1}-${adj2}-${noun}`;
}

/**
 * Check if a directory exists
 */
async function directoryExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get the .collab directory path relative to the given base directory
 */
function getCollabDir(baseDir: string): string {
  return join(baseDir, '.collab');
}

/**
 * Get the sessions directory path (.collab/sessions)
 */
function getSessionsDir(baseDir: string): string {
  return join(baseDir, '.collab', 'sessions');
}

/**
 * Check if old session structure exists (.collab/<name>/ with collab-state.json)
 * Returns true if we should check old paths for backwards compatibility
 */
async function hasOldSessionStructure(baseDir: string): Promise<boolean> {
  const collabDir = getCollabDir(baseDir);
  if (!(await directoryExists(collabDir))) {
    return false;
  }

  try {
    const entries = await readdir(collabDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'sessions' || entry.name === 'kodex') continue;
      const statePath = join(collabDir, entry.name, 'collab-state.json');
      try {
        await access(statePath);
        return true; // Found old-style session
      } catch {
        continue;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * List all collab sessions in the .collab/sessions directory
 * Also checks old location (.collab/<name>) for backwards compatibility
 * @param baseDir - The base directory to search in (typically cwd)
 */
export async function listCollabSessions(baseDir: string): Promise<CollabSession[]> {
  const sessions: CollabSession[] = [];

  // Helper to read sessions from a directory
  async function readSessionsFromDir(dir: string): Promise<void> {
    if (!(await directoryExists(dir))) {
      return;
    }

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Skip special directories
        if (entry.name === 'sessions' || entry.name === 'kodex') continue;

        const sessionPath = join(dir, entry.name);
        const statePath = join(sessionPath, 'collab-state.json');
        const metadataPath = join(sessionPath, 'metadata.json');

        try {
          // Read collab-state.json
          const stateContent = await readFile(statePath, 'utf-8');
          const state: CollabState = JSON.parse(stateContent);

          // Try to read metadata.json for template info
          let template: CollabTemplate = state.template || 'feature';
          try {
            const metadataContent = await readFile(metadataPath, 'utf-8');
            const metadata: CollabMetadata = JSON.parse(metadataContent);
            template = metadata.template || template;
          } catch {
            // metadata.json might not exist or be malformed
          }

          // Skip if we already have this session (from new location)
          if (sessions.some(s => s.name === entry.name)) continue;

          sessions.push({
            name: entry.name,
            template,
            phase: state.phase,
            lastActivity: state.lastActivity,
            pendingIssueCount: state.pendingVerificationIssues?.length || 0,
            path: sessionPath,
          });
        } catch {
          // Skip directories without valid collab-state.json
          continue;
        }
      }
    } catch {
      // If we can't read the directory, continue
    }
  }

  // First, read from new location (.collab/sessions/)
  const sessionsDir = getSessionsDir(baseDir);
  await readSessionsFromDir(sessionsDir);

  // Then check old location (.collab/) for backwards compatibility
  const collabDir = getCollabDir(baseDir);
  await readSessionsFromDir(collabDir);

  // Sort by last activity (most recent first)
  sessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  return sessions;
}

/**
 * Create a new collab session
 * @param baseDir - The base directory (typically cwd)
 * @param template - The session template type
 * @param customName - Optional custom name (otherwise auto-generated)
 */
export async function createCollabSession(
  baseDir: string,
  template: CollabTemplate,
  customName?: string
): Promise<{ name: string; path: string }> {
  const sessionsDir = getSessionsDir(baseDir);

  // Create .collab/sessions directory if it doesn't exist
  if (!(await directoryExists(sessionsDir))) {
    await mkdir(sessionsDir, { recursive: true });
  }

  // Generate or use provided name
  let name = customName || generateSessionName();

  // Ensure unique name (check both new and old locations)
  let sessionPath = join(sessionsDir, name);
  const oldSessionPath = join(getCollabDir(baseDir), name);
  let attempts = 0;
  while ((await directoryExists(sessionPath) || await directoryExists(oldSessionPath)) && attempts < 10) {
    name = generateSessionName();
    sessionPath = join(sessionsDir, name);
    attempts++;
  }

  if (await directoryExists(sessionPath)) {
    throw new Error('Could not generate unique session name after 10 attempts');
  }

  // Create session directory structure
  await mkdir(sessionPath, { recursive: true });
  await mkdir(join(sessionPath, 'diagrams'), { recursive: true });
  await mkdir(join(sessionPath, 'documents'), { recursive: true });

  const now = new Date().toISOString();

  // Create metadata.json
  const metadata: CollabMetadata = {
    name,
    template,
    createdAt: now,
    description: '',
  };
  await writeFile(
    join(sessionPath, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );

  // Create collab-state.json
  const state: CollabState = {
    phase: 'brainstorming',
    template,
    lastActivity: now,
    pendingVerificationIssues: [],
  };
  await writeFile(
    join(sessionPath, 'collab-state.json'),
    JSON.stringify(state, null, 2)
  );

  return { name, path: sessionPath };
}

/**
 * Find the actual path to a session (checks new then old location)
 */
async function findSessionPath(baseDir: string, sessionName: string): Promise<string | null> {
  // Check new location first
  const newPath = join(getSessionsDir(baseDir), sessionName);
  if (await directoryExists(newPath)) {
    return newPath;
  }

  // Check old location for backwards compatibility
  const oldPath = join(getCollabDir(baseDir), sessionName);
  if (await directoryExists(oldPath)) {
    return oldPath;
  }

  return null;
}

/**
 * Get the state of a collab session
 * @param baseDir - The base directory (typically cwd)
 * @param sessionName - The session name
 */
export async function getCollabSessionState(
  baseDir: string,
  sessionName: string
): Promise<CollabState> {
  const sessionPath = await findSessionPath(baseDir, sessionName);
  if (!sessionPath) {
    throw new Error(`Session not found or invalid: ${sessionName}`);
  }

  const statePath = join(sessionPath, 'collab-state.json');
  try {
    const content = await readFile(statePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Session not found or invalid: ${sessionName}`);
  }
}

/**
 * Update the state of a collab session
 * @param baseDir - The base directory (typically cwd)
 * @param sessionName - The session name
 * @param updates - Partial state updates to apply
 */
export async function updateCollabSessionState(
  baseDir: string,
  sessionName: string,
  updates: Partial<CollabState>
): Promise<CollabState> {
  const sessionPath = await findSessionPath(baseDir, sessionName);
  if (!sessionPath) {
    throw new Error(`Session not found or invalid: ${sessionName}`);
  }

  const statePath = join(sessionPath, 'collab-state.json');

  // Read current state
  let currentState: CollabState;
  try {
    const content = await readFile(statePath, 'utf-8');
    currentState = JSON.parse(content);
  } catch {
    throw new Error(`Session not found or invalid: ${sessionName}`);
  }

  // Merge updates
  const newState: CollabState = {
    ...currentState,
    ...updates,
    lastActivity: new Date().toISOString(),
  };

  // Write updated state
  await writeFile(statePath, JSON.stringify(newState, null, 2));

  return newState;
}

/**
 * Get the absolute path to a collab session
 * Checks new location first, then old location for backwards compatibility
 * @param baseDir - The base directory (typically cwd)
 * @param sessionName - The session name
 */
export async function getCollabSessionPath(baseDir: string, sessionName: string): Promise<string> {
  const sessionPath = await findSessionPath(baseDir, sessionName);
  if (sessionPath) {
    return sessionPath;
  }
  // Default to new location for new sessions
  return join(getSessionsDir(baseDir), sessionName);
}

/**
 * Synchronous version for cases where async isn't possible
 * Prefers new location, but caller should verify existence
 */
export function getCollabSessionPathSync(baseDir: string, sessionName: string): string {
  return join(getSessionsDir(baseDir), sessionName);
}
