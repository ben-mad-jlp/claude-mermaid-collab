const KEY_PREFIX = 'autocorrect:dict:';

function keyFor(project: string): string {
  return KEY_PREFIX + project;
}

export function getPersonalDict(project: string): Set<string> {
  if (typeof localStorage === 'undefined') {
    return new Set();
  }
  try {
    const key = keyFor(project);
    const data = localStorage.getItem(key);
    if (data === null) {
      return new Set();
    }
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

export function addToPersonalDict(project: string, word: string): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    const trimmed = word.trim().toLowerCase();
    if (!trimmed) {
      return;
    }
    const dict = getPersonalDict(project);
    dict.add(trimmed);
    const key = keyFor(project);
    localStorage.setItem(key, JSON.stringify([...dict]));
  } catch {
    // Silently ignore quota/serialization errors
  }
}
