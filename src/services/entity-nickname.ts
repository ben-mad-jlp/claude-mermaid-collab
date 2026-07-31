const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'for', 'and', 'or', 'in', 'on', 'with', 'is', 'are', 'this',
  'that',
]);

function fallbackFromTitle(title: string): string {
  let sum = 0;
  for (let i = 0; i < title.length; i++) {
    sum += title.charCodeAt(i);
  }
  const n = title.length === 0 ? 0 : sum % 10000;
  return `item-${n}`;
}

export function nicknameFromTitle(title: string): string {
  const lowered = title.toLowerCase();
  const withoutBrackets = lowered.replace(/\[[^\]]*\]/g, ' ');
  const cleaned = withoutBrackets.replace(/[^a-z0-9\s-]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return fallbackFromTitle(title);
  }

  const withoutStopwords = tokens.filter((t) => !STOPWORDS.has(t));

  const source = withoutStopwords.length >= 2 ? withoutStopwords : tokens;

  if (source.length === 0) {
    return fallbackFromTitle(title);
  }

  return source.slice(0, 4).join('-');
}

export function uniqueNickname(base: string, taken: Iterable<string>): string {
  const takenSet = new Set(taken);
  if (!takenSet.has(base)) {
    return base;
  }
  let i = 2;
  let candidate = `${base}-${i}`;
  while (takenSet.has(candidate)) {
    i++;
    candidate = `${base}-${i}`;
  }
  return candidate;
}
